import type { FastifyBaseLogger } from 'fastify';
import type { CapiClient } from '../capi/client.js';
import type { Config } from '../config.js';
import { appFailure, callApp } from './app-calls.js';
import { OsbFailure } from './errors.js';
import type { InstanceService, OsbResult } from './instances.js';

export interface BindRequest {
  service_id: string;
  plan_id: string;
  parameters?: Record<string, unknown>;
  app_guid?: string;
  bind_resource?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/** Credentials of a binding (OSB3-F-01). Never logged or cached (OSB3-F-04). */
export interface Credentials {
  kubeconfig: string;
  server?: string;
  cluster: string;
  namespace: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** API server URL of the first cluster in a kubeconfig, without a YAML parser (ADR-0009). */
export function serverOf(kubeconfig: string): string | undefined {
  const match = /^\s*server:\s*["']?([^\s"'#]+)["']?/m.exec(kubeconfig);
  return match?.[1];
}

/**
 * Bind and unbind (OSB-3). A binding hands out the admin kubeconfig of the instance's cluster;
 * the broker keeps no state, so unbinding has nothing to revoke.
 */
export class BindingService {
  constructor(
    private readonly capi: CapiClient,
    private readonly config: Config,
    private readonly instances: InstanceService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** OSB3-F-01, OSB3-F-02. */
  async bind(instanceId: string, bindingId: string, req: BindRequest): Promise<OsbResult> {
    if (req.service_id !== this.config.offering.id) {
      throw new OsbFailure(400, `This broker does not offer the service ${req.service_id}.`);
    }
    if (req.parameters && Object.keys(req.parameters).length > 0) {
      throw new OsbFailure(400, 'Bindings of this service take no parameters.');
    }
    if (!UUID.test(bindingId)) throw new OsbFailure(400, 'The binding ID must be a UUID.');

    const cluster = UUID.test(instanceId) ? await this.instances.find(instanceId) : undefined;
    if (!cluster) {
      throw new OsbFailure(400, 'The service instance does not exist (its cluster was not found).');
    }
    if (cluster.deletion) {
      throw new OsbFailure(422, 'The service instance is being deleted.', 'ConcurrencyError');
    }
    if (!cluster.ready) {
      throw new OsbFailure(
        422,
        'The cluster of the service instance is not ready yet; bind again when it is.',
        'ConcurrencyError',
      );
    }

    const { data, error, response } = await callApp(this.log, 'reading the kubeconfig', () =>
      this.capi.GET('/api/connections/{connection}/clusters/{namespace}/{name}/kubeconfig', {
        params: {
          path: {
            connection: this.config.capi.connection,
            namespace: cluster.namespace,
            name: cluster.name,
          },
        },
        parseAs: 'text',
      }),
    );
    if (typeof data !== 'string' || !data) {
      if (response.status === 404) {
        throw new OsbFailure(
          422,
          'The kubeconfig of the cluster is not available yet; bind again in a minute.',
          'ConcurrencyError',
        );
      }
      throw appFailure(this.log, 'reading the kubeconfig', response.status, error);
    }

    const server = serverOf(data);
    const credentials: Credentials = {
      kubeconfig: data,
      ...(server ? { server } : {}),
      cluster: cluster.name,
      namespace: cluster.namespace,
    };
    return { status: 201, body: { credentials } };
  }

  /** OSB3-F-03: nothing to revoke, no call to the app. */
  unbind(): OsbResult {
    return { status: 200, body: {} };
  }
}
