import type { FastifyBaseLogger } from 'fastify';
import type { CapiClient, ClusterBlueprint } from '../capi/client.js';
import type { Config } from '../config.js';
import { describeError } from '../probes.js';
import { uuidV5 } from './uuid.js';

/** A plan of the catalog (OSB API "Service Plan Object"). */
export interface Plan {
  id: string;
  name: string;
  description: string;
  free: boolean;
  bindable: true;
  plan_updateable: false;
  maximum_polling_duration: number;
  metadata: { displayName: string; bullets: string[] };
  schemas: { service_instance: { create: { parameters: Record<string, unknown> } } };
}

/** The service offering of the catalog (OSB API "Service Offering Object"). */
export interface Offering {
  id: string;
  name: string;
  description: string;
  tags: string[];
  bindable: true;
  plan_updateable: false;
  instances_retrievable: false;
  bindings_retrievable: false;
  metadata: { displayName: string; providerDisplayName: string };
  plans: Plan[];
}

export interface Catalog {
  services: Offering[];
}

/** A plan with the blueprint it comes from, for provisioning (OSB-2). */
export interface PlanEntry {
  plan: Plan;
  blueprint: ClusterBlueprint;
}

/** The catalog cannot be loaded; `description` is meant for Cloud Foundry users. */
export class CatalogUnavailableError extends Error {
  constructor(readonly description: string) {
    super(description);
    this.name = 'CatalogUnavailableError';
  }
}

const PROVIDERS: Record<string, string> = {
  openstack: 'OpenStack',
  aws: 'AWS',
  gcp: 'Google Cloud',
  proxmox: 'Proxmox VE',
};

const FLAVORS: Record<string, string> = { rke2: 'RKE2', k0s: 'k0s', kubeadm: 'kubeadm' };

/**
 * The catalog: one offering with one plan per blueprint of the configured connection
 * (OSB1-F-01 to OSB1-F-04), cached for a short time (OSB1-F-05). Concurrent requests share one
 * call to CAPI Navigator. Errors are not cached and no stale catalog is served: the next request
 * loads it again.
 */
export class CatalogService {
  private cached?: { entries: PlanEntry[]; expiresAt: number };
  private loading?: Promise<PlanEntry[]>;

  constructor(
    private readonly capi: CapiClient,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  async catalog(): Promise<Catalog> {
    const entries = await this.entries();
    if (entries.length === 0) return { services: [] }; // an offering needs at least one plan
    const { offering } = this.config;
    return {
      services: [
        {
          id: offering.id,
          name: offering.name,
          description: offering.description,
          tags: ['kubernetes', 'cluster-api'],
          bindable: true,
          plan_updateable: false,
          instances_retrievable: false,
          bindings_retrievable: false,
          metadata: { displayName: 'Kubernetes cluster', providerDisplayName: 'CAPI Navigator' },
          plans: entries.map((e) => e.plan),
        },
      ],
    };
  }

  /** The plan with this ID and its blueprint, or undefined if the catalog does not offer it. */
  async planById(planId: string): Promise<PlanEntry | undefined> {
    return (await this.entries()).find((e) => e.plan.id === planId);
  }

  private async entries(): Promise<PlanEntry[]> {
    if (this.cached && this.now() < this.cached.expiresAt) return this.cached.entries;
    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async load(): Promise<PlanEntry[]> {
    let result;
    try {
      result = await this.capi.GET('/api/blueprints');
    } catch (err) {
      this.log.warn({ err: describeError(err) }, 'catalog: CAPI Navigator not reachable');
      throw new CatalogUnavailableError('CAPI Navigator is not reachable; try again later.');
    }
    const { data, error, response } = result;
    if (!data) {
      this.log.warn({ capiStatus: response.status, message: error?.message }, 'catalog: failed');
      throw new CatalogUnavailableError(
        response.status === 401 || response.status === 403
          ? 'CAPI Navigator refuses the token of the broker; ask the operator of the broker.'
          : `CAPI Navigator answered ${response.status}${error?.message ? `: ${error.message}` : ''}`,
      );
    }
    const entries = data
      .filter((bp) => bp.spec.connection === this.config.capi.connection)
      .filter((bp) => matchesFilter(bp.name, this.config.blueprintFilter))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((blueprint) => ({ blueprint, plan: this.toPlan(blueprint) }));
    this.cached = { entries, expiresAt: this.now() + this.config.catalog.cacheMs };
    return entries;
  }

  /** OSB1-F-02: a blueprint as plan. */
  private toPlan(bp: ClusterBlueprint): Plan {
    const { cluster } = bp.spec;
    const versions = [
      ...new Set([cluster.kubernetes.version, ...(bp.spec.parameters.kubernetesVersions ?? [])]),
    ].filter(Boolean);
    const flavor = cluster.kubernetes.flavor ?? 'rke2';
    const provider = cluster.infrastructure.provider;
    const bullets = [
      ...(bp.spec.description ? [bp.spec.description] : []),
      `Infrastructure: ${PROVIDERS[provider] ?? provider}`,
      `Kubernetes: ${FLAVORS[flavor] ?? flavor} ${versions.join(', ')}`.trim(),
    ];
    return {
      id: uuidV5(bp.name, this.config.offering.id),
      name: bp.name,
      description: bp.spec.displayName,
      free: this.config.catalog.plansFree,
      bindable: true,
      plan_updateable: false,
      maximum_polling_duration: this.config.catalog.maxPollingDurationSeconds,
      metadata: { displayName: bp.spec.displayName, bullets },
      schemas: { service_instance: { create: { parameters: bp.parametersSchema } } },
    };
  }
}

/** OSB1-F-04: no filter offers everything; an entry ending with * matches a name prefix. */
export function matchesFilter(name: string, filter: string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => (f.endsWith('*') ? name.startsWith(f.slice(0, -1)) : name === f));
}
