import Fastify, { type FastifyInstance } from 'fastify';
import type { components } from '../../src/capi/schema.generated.js';
import type { ClusterBlueprint, ClusterSummary } from '../../src/capi/client.js';

type Me = components['schemas']['Me'];
type DeletionStatus = components['schemas']['DeletionStatus'];

export const FAKE_TOKEN = 'capin_fake-token-for-tests';

export interface FakeCluster {
  connection: string;
  summary: ClusterSummary;
  conditions?: components['schemas']['Condition'][];
  kubeconfig?: string;
}

export interface FakeRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
}

/**
 * In-memory fake of the CAPI Navigator endpoints the broker uses (OSB0-F-06), typed against the
 * generated schema so it follows the pinned OpenAPI document.
 */
export class FakeCapiNavigator {
  readonly blueprints: ClusterBlueprint[] = [];
  readonly clusters: FakeCluster[] = [];
  readonly requests: FakeRequest[] = [];
  /** Answers every request with this status and an ApiErrorBody, if set. */
  failWith?: { status: number; message: string; hint?: string };
  private server?: FastifyInstance;

  async start(): Promise<string> {
    const app = Fastify();
    this.server = app;

    app.addHook('onRequest', async (req, reply) => {
      this.requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: undefined,
      });
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) {
        return reply.code(401).send({ statusCode: 401, message: 'Not signed in' });
      }
      if (this.failWith) {
        const { status, message, hint } = this.failWith;
        return reply.code(status).send({ statusCode: status, message, ...(hint ? { hint } : {}) });
      }
    });
    app.addHook('preHandler', async (req) => {
      const last = this.requests.at(-1);
      if (last) last.body = req.body;
    });

    app.get('/api/auth/me', async () => {
      const me = {
        username: 'osb-broker',
        role: 'broker',
        bindings: [],
        mustChangePassword: false,
        source: 'local',
      };
      return me as unknown as Me;
    });

    app.get('/api/blueprints', async () => this.blueprints);

    app.post<{
      Params: { blueprint: string };
      Body: { name: string; parameters?: Record<string, unknown>; labels?: Record<string, string> };
    }>('/api/blueprints/:blueprint/clusters', async (req, reply) => {
      const bp = this.blueprints.find((b) => b.name === req.params.blueprint);
      if (!bp) return reply.code(404).send({ statusCode: 404, message: 'Blueprint not found' });
      const connection = bp.spec.connection;
      const namespace = bp.spec.cluster.namespace;
      if (this.find(connection, namespace, req.body.name)) {
        return reply
          .code(409)
          .send({ statusCode: 409, message: `Cluster ${req.body.name} already exists` });
      }
      const summary: ClusterSummary = {
        name: req.body.name,
        namespace,
        phase: 'Provisioning',
        ready: false,
        labels: { ...req.body.labels },
        managed: true,
        blueprint: bp.name,
      };
      this.clusters.push({ connection, summary });
      return reply.code(201).send(summary);
    });

    app.get<{ Params: { connection: string }; Querystring: { labelSelector?: string } }>(
      '/api/connections/:connection/clusters',
      async (req) => {
        const selector = parseSelector(req.query.labelSelector);
        return this.clusters
          .filter((c) => c.connection === req.params.connection)
          .filter((c) => Object.entries(selector).every(([k, v]) => c.summary.labels[k] === v))
          .map((c) => c.summary);
      },
    );

    type ClusterParams = { Params: { connection: string; namespace: string; name: string } };

    app.get<ClusterParams>(
      '/api/connections/:connection/clusters/:namespace/:name',
      async (req, reply) => {
        const c = this.find(req.params.connection, req.params.namespace, req.params.name);
        if (!c) return reply.code(404).send({ statusCode: 404, message: 'Cluster not found' });
        return {
          summary: c.summary,
          conditions: c.conditions ?? [],
          machineDeployments: [],
          machines: [],
          events: [],
          kubeconfigAvailable: c.kubeconfig !== undefined,
        };
      },
    );

    app.get<ClusterParams>(
      '/api/connections/:connection/clusters/:namespace/:name/kubeconfig',
      async (req, reply) => {
        const c = this.find(req.params.connection, req.params.namespace, req.params.name);
        if (!c?.kubeconfig) {
          return reply.code(404).send({ statusCode: 404, message: 'Kubeconfig not found' });
        }
        return reply.type('text/plain').send(c.kubeconfig);
      },
    );

    app.post<ClusterParams & { Body: { confirmName: string; cleanup?: boolean } }>(
      '/api/connections/:connection/clusters/:namespace/:name/delete',
      async (req, reply) => {
        const c = this.find(req.params.connection, req.params.namespace, req.params.name);
        if (!c) return reply.code(404).send({ statusCode: 404, message: 'Cluster not found' });
        if (req.body.confirmName !== c.summary.name) {
          return reply.code(400).send({ statusCode: 400, message: 'The name does not match' });
        }
        const deletion: DeletionStatus = c.summary.deletion ?? {
          phase: req.body.cleanup === false ? 'deleting' : 'cleanup',
          startedAt: new Date().toISOString(),
        };
        c.summary.deletion = deletion;
        return reply.code(202).send(deletion);
      },
    );

    return app.listen({ host: '127.0.0.1', port: 0 });
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }

  find(connection: string, namespace: string, name: string): FakeCluster | undefined {
    return this.clusters.find(
      (c) =>
        c.connection === connection && c.summary.namespace === namespace && c.summary.name === name,
    );
  }
}

/** Equality-based selectors only (`a=b,c=d`), the form the broker sends. */
function parseSelector(selector?: string): Record<string, string> {
  if (!selector) return {};
  return Object.fromEntries(
    selector.split(',').map((term) => {
      const [k = '', v = ''] = term.split('=');
      return [k.trim(), v.trim()];
    }),
  );
}
