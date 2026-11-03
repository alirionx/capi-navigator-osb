import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  isTimeout,
  type ApiErrorBody,
  type CapiClient,
  type ClusterSummary,
} from '../capi/client.js';
import type { Config } from '../config.js';
import { describeError } from '../probes.js';
import { CatalogUnavailableError, type CatalogService } from './catalog.js';
import { OsbFailure } from './errors.js';

export interface OsbResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ProvisionRequest {
  service_id: string;
  plan_id: string;
  parameters?: Record<string, unknown>;
  context?: { organization_guid?: string; space_guid?: string; [key: string]: unknown };
  organization_guid?: string;
  space_guid?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_VALUE = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/;

const ASYNC_REQUIRED = new OsbFailure(
  422,
  'This service creates and deletes clusters asynchronously; the platform must send accepts_incomplete=true.',
  'AsyncRequired',
);
const UNREACHABLE = 'CAPI Navigator is not reachable; try again later.';
const TOKEN_REFUSED =
  'CAPI Navigator refuses the token of the broker; ask the operator of the broker.';

/** Cluster name of an instance (section 3, ADR-0008): `cf-` plus the UUID without hyphens. */
export const clusterName = (instanceId: string) =>
  `cf-${instanceId.replace(/-/g, '').toLowerCase()}`;

/** Parameters hash (section 3, ADR-0008). */
export function paramsHash(planId: string, parameters: unknown): string {
  return createHash('sha256')
    .update(`${planId}\n${canonicalJson(parameters ?? {})}`)
    .digest('hex')
    .slice(0, 32);
}

/** JSON with object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Message, hint and field errors of the app as one description for Cloud Foundry users. */
export function appDescription(body: ApiErrorBody | undefined, fallback: string): string {
  if (!body?.message) return fallback;
  const fields = Object.entries(body.fieldErrors ?? {}).map(
    ([field, messages]) => `${field}: ${messages.join(', ')}`,
  );
  return [body.message + (fields.length ? ` (${fields.join('; ')})` : ''), body.hint]
    .filter(Boolean)
    .join('. ')
    .replace(/\.\./g, '.');
}

/**
 * Provision, deprovision and last operation of service instances (OSB-2). Stateless: an instance
 * is the cluster with its instance label in CAPI Navigator (hard rule 1).
 */
export class InstanceService {
  constructor(
    private readonly capi: CapiClient,
    private readonly config: Config,
    private readonly catalog: CatalogService,
    private readonly log: FastifyBaseLogger,
  ) {}

  private label(key: string): string {
    return `${this.config.labelPrefix}/${key}`;
  }

  /** The cluster of an instance, found by its instance label. */
  async find(instanceId: string): Promise<ClusterSummary | undefined> {
    const { data, error, response } = await this.call('looking up the instance', () =>
      this.capi.GET('/api/connections/{connection}/clusters', {
        params: {
          path: { connection: this.config.capi.connection },
          query: { labelSelector: `${this.label('instance-id')}=${instanceId}` },
        },
      }),
    );
    if (!data) throw this.appFailure('looking up the instance', response.status, error);
    if (data.length > 1) {
      this.log.warn({ instanceId, clusters: data.map((c) => c.name) }, 'several clusters found');
    }
    return data[0];
  }

  /** OSB2-F-01 to OSB2-F-04. */
  async provision(
    instanceId: string,
    req: ProvisionRequest,
    acceptsIncomplete: boolean,
  ): Promise<OsbResult> {
    if (!acceptsIncomplete) throw ASYNC_REQUIRED;
    if (!UUID.test(instanceId)) {
      throw new OsbFailure(400, 'The instance ID must be a UUID.');
    }
    if (req.service_id !== this.config.offering.id) {
      throw new OsbFailure(400, `This broker does not offer the service ${req.service_id}.`);
    }
    const hash = paramsHash(req.plan_id, req.parameters);

    const existing = await this.find(instanceId);
    if (existing) return this.repeatedProvision(existing, hash);

    let entry;
    try {
      entry = await this.catalog.planById(req.plan_id);
    } catch (err) {
      if (err instanceof CatalogUnavailableError) throw new OsbFailure(500, err.description);
      throw err;
    }
    if (!entry) {
      throw new OsbFailure(400, `This broker does not offer the plan ${req.plan_id}.`);
    }

    const labels: Record<string, string> = {
      [this.label('instance-id')]: instanceId,
      [this.label('params-hash')]: hash,
    };
    // OSB2-F-04: only the GUIDs, as labels; names may change.
    const orgGuid = req.context?.organization_guid ?? req.organization_guid;
    const spaceGuid = req.context?.space_guid ?? req.space_guid;
    if (orgGuid && LABEL_VALUE.test(orgGuid) && orgGuid.length <= 63) {
      labels[this.label('org-guid')] = orgGuid;
    }
    if (spaceGuid && LABEL_VALUE.test(spaceGuid) && spaceGuid.length <= 63) {
      labels[this.label('space-guid')] = spaceGuid;
    }

    const { data, error, response } = await this.call('creating the cluster', () =>
      this.capi.POST('/api/blueprints/{blueprint}/clusters', {
        params: { path: { blueprint: entry.blueprint.name } },
        body: { name: clusterName(instanceId), parameters: req.parameters ?? {}, labels },
      }),
    );
    if (data) return { status: 202, body: { operation: 'provision' } };

    // OSB2-F-03: answers that leave nothing behind.
    switch (response.status) {
      case 400:
        throw new OsbFailure(400, appDescription(error, 'The parameters are invalid.'));
      case 404:
        throw new OsbFailure(
          400,
          `The plan ${entry.plan.name} is no longer available; choose another plan.`,
        );
      case 409: {
        // ADR-0004: an existing name means another request created the instance meanwhile.
        const created = await this.find(instanceId);
        if (created) return this.repeatedProvision(created, hash);
        throw new OsbFailure(
          400,
          appDescription(error, 'CAPI Navigator cannot create the cluster now.'),
        );
      }
      default:
        throw this.appFailure('creating the cluster', response.status, error);
    }
  }

  private repeatedProvision(cluster: ClusterSummary, hash: string): OsbResult {
    if (cluster.deletion) {
      throw new OsbFailure(409, 'An instance with this ID exists and is being deleted.');
    }
    if (cluster.labels[this.label('params-hash')] !== hash) {
      throw new OsbFailure(409, 'An instance with this ID exists with another plan or parameters.');
    }
    return cluster.ready
      ? { status: 200, body: {} }
      : { status: 202, body: { operation: 'provision' } };
  }

  /** OSB2-F-01, OSB2-F-06, ADR-0008. */
  async deprovision(instanceId: string, acceptsIncomplete: boolean): Promise<OsbResult> {
    if (!acceptsIncomplete) throw ASYNC_REQUIRED;
    if (!UUID.test(instanceId)) return { status: 410, body: {} };
    const cluster = await this.find(instanceId);
    if (!cluster) return { status: 410, body: {} };
    const accepted = { status: 202, body: { operation: 'deprovision' } };
    if (cluster.deletion) return accepted;

    let result;
    try {
      result = await this.capi.POST(
        '/api/connections/{connection}/clusters/{namespace}/{name}/delete',
        {
          params: {
            path: {
              connection: this.config.capi.connection,
              namespace: cluster.namespace,
              name: cluster.name,
            },
          },
          body: { confirmName: cluster.name, cleanup: true, skipDrain: false },
        },
      );
    } catch (err) {
      if (isTimeout(err)) {
        // ADR-0008: the app goes on deleting; last_operation follows the progress.
        this.log.warn({ instanceId, cluster: cluster.name }, 'delete call timed out, accepted');
        return accepted;
      }
      this.log.warn({ err: describeError(err) }, 'CAPI Navigator not reachable');
      throw new OsbFailure(500, UNREACHABLE);
    }
    const { data, error, response } = result;
    if (data) return accepted;
    if (response.status === 404) return { status: 410, body: {} };
    if (response.status === 400 || response.status === 409) {
      throw new OsbFailure(
        400,
        appDescription(error, 'CAPI Navigator cannot delete the cluster now.'),
      );
    }
    throw this.appFailure('deleting the cluster', response.status, error);
  }

  /** OSB2-F-05. */
  async lastOperation(instanceId: string, operation: string | undefined): Promise<OsbResult> {
    const cluster = UUID.test(instanceId) ? await this.find(instanceId) : undefined;
    const op = operation ?? (cluster?.deletion ? 'deprovision' : 'provision');

    if (op === 'deprovision') {
      if (!cluster) return { status: 410, body: {} };
      const deletion = cluster.deletion;
      if (deletion?.phase === 'cleanup-timeout') {
        return state(
          'failed',
          `The cleanup in the cluster timed out${deletion.message ? `: ${deletion.message}` : ''}. ` +
            'Delete the service again, or ask an admin of CAPI Navigator to check the cluster.',
        );
      }
      if (!deletion) return state('in progress', 'Deletion starting.');
      return state(
        'in progress',
        deletion.phase === 'cleanup'
          ? 'Removing load balancers and volumes in the cluster.'
          : 'Deleting the cluster.',
      );
    }

    if (!cluster) {
      return state(
        'failed',
        'The cluster of this instance does not exist: it was not created or was deleted outside the broker.',
      );
    }
    if (cluster.deletion) return state('failed', 'The cluster of this instance is being deleted.');
    if (cluster.ready) return state('succeeded', `Cluster ${cluster.name} is ready.`);
    if (cluster.phase === 'Failed') {
      return state('failed', await this.failureMessage(cluster));
    }
    const ready: string[] = [];
    if (cluster.controlPlane) {
      ready.push(`control plane ${cluster.controlPlane.ready}/${cluster.controlPlane.replicas}`);
    }
    if (cluster.workers) ready.push(`workers ${cluster.workers.ready}/${cluster.workers.replicas}`);
    return state(
      'in progress',
      ready.length ? `${cluster.phase}: ${ready.join(', ')} ready.` : `${cluster.phase}.`,
    );
  }

  /** ADR-0005: the message of the first condition with status False. */
  private async failureMessage(cluster: ClusterSummary): Promise<string> {
    const fallback = `Creating the cluster failed (phase ${cluster.phase}).`;
    try {
      const { data } = await this.capi.GET(
        '/api/connections/{connection}/clusters/{namespace}/{name}',
        {
          params: {
            path: {
              connection: this.config.capi.connection,
              namespace: cluster.namespace,
              name: cluster.name,
            },
          },
        },
      );
      const message = data?.conditions.find((c) => c.status === 'False' && c.message)?.message;
      return message ? `Creating the cluster failed: ${message}` : fallback;
    } catch (err) {
      this.log.warn({ err: describeError(err) }, 'cluster status not readable');
      return fallback;
    }
  }

  private async call<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.log.warn({ err: describeError(err), action }, 'CAPI Navigator not reachable');
      throw new OsbFailure(500, UNREACHABLE);
    }
  }

  private appFailure(action: string, status: number, error?: ApiErrorBody): OsbFailure {
    this.log.warn({ action, capiStatus: status, message: error?.message }, 'CAPI Navigator error');
    if (status === 401 || status === 403) return new OsbFailure(500, TOKEN_REFUSED);
    return new OsbFailure(
      500,
      `CAPI Navigator answered ${status} while ${action}${error?.message ? `: ${error.message}` : ''}.`,
    );
  }
}

function state(s: 'in progress' | 'succeeded' | 'failed', description: string): OsbResult {
  return { status: 200, body: { state: s, description } };
}
