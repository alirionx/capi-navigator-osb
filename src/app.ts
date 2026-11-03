import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { CapiClient } from './capi/client.js';
import type { Config } from './config.js';
import { registerDocs } from './docs.js';
import { BindingService } from './osb/bindings.js';
import { CatalogService } from './osb/catalog.js';
import { OsbFailure, sendOsbError } from './osb/errors.js';
import { registerOsbGuard } from './osb/guard.js';
import { originatingUser } from './osb/identity.js';
import { InstanceService } from './osb/instances.js';
import { registerOsbRoutes } from './osb/routes.js';
import { registerProbes } from './probes.js';

export interface AppOptions {
  config: Config;
  capi: CapiClient;
  /** Logger settings; tests pass a stream to read the log lines. */
  logger?: FastifyServerOptions['logger'];
}

/** Paths that must never show up in a log line (OSB0-F-05, hard rule 3). */
export const REDACT = [
  'req.headers.authorization',
  'headers.authorization',
  '*.token',
  '*.password',
  '*.kubeconfig',
  '*.credentials',
];

const REQUEST_IDENTITY = 'x-broker-api-request-identity';

export async function buildApp({ config, capi, logger }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel, redact: REDACT },
    // Fastify's own request lines are replaced by the onResponse hook below.
    logController: new LogController({ disableRequestLogging: true }),
  });

  // OSB0-F-03: echo the request identity of the platform.
  app.addHook('onSend', async (req, reply) => {
    const id = req.headers[REQUEST_IDENTITY];
    if (typeof id === 'string') reply.header(REQUEST_IDENTITY, id);
  });

  // OSB0-F-05: one line per request, never credentials. Probes and docs only at debug level.
  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0] ?? req.url;
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const requestId = req.headers[REQUEST_IDENTITY];
    const fields = {
      method: req.method,
      path,
      instanceId: params.instance_id,
      bindingId: params.binding_id,
      userId: originatingUser(req.headers['x-broker-api-originating-identity']),
      requestId: typeof requestId === 'string' ? requestId : undefined,
      statusCode: reply.statusCode,
      responseTimeMs: Math.round(reply.elapsedTime),
    };
    if (path.startsWith('/v2/')) req.log.info(fields, 'request');
    else req.log.debug(fields, 'request');
  });

  if (config.swaggerUi) await registerDocs(app, config);

  registerProbes(app, capi);

  const catalog = new CatalogService(capi, config, app.log);
  const instances = new InstanceService(capi, config, catalog, app.log);
  const bindings = new BindingService(capi, config, instances, app.log);

  await app.register(
    async (v2) => {
      registerOsbGuard(v2, config.broker);
      v2.setNotFoundHandler((_req, reply) =>
        sendOsbError(reply, 404, 'This endpoint does not exist.'),
      );
      v2.setErrorHandler<FastifyError>((err, req, reply) => {
        if (err instanceof OsbFailure) {
          return sendOsbError(reply, err.status, err.description, err.error);
        }
        const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        if (status >= 500) req.log.error({ err }, 'request failed');
        return sendOsbError(reply, status, status < 500 ? err.message : 'Internal broker error.');
      });
      registerOsbRoutes(v2, { config, catalog, instances, bindings });
    },
    { prefix: '/v2' },
  );

  return app;
}
