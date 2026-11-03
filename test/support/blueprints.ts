import type { ClusterBlueprint } from '../../src/capi/client.js';

/** A parametersSchema like CAPI Navigator generates it (FP34-F-03, draft-04). */
export function parametersSchema(maxWorkers = 3): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {
      workerPools: {
        type: 'object',
        properties: {
          default: {
            type: 'object',
            properties: {
              replicas: {
                default: 1,
                type: 'integer',
                minimum: 1,
                maximum: maxWorkers,
                description: 'Workers in pool default',
              },
              machineSize: { default: 'm1.small', type: 'string', enum: ['m1.small', 'm1.large'] },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      kubernetesVersion: { default: 'v1.35.9+rke2r1', type: 'string', enum: ['v1.35.9+rke2r1'] },
    },
    additionalProperties: false,
  };
}

interface BlueprintOptions {
  connection?: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  provider?: string;
  flavor?: string;
  version?: string;
  versions?: string[];
}

/**
 * A blueprint as `GET /api/blueprints` returns it. The base cluster spec carries only the fields
 * the broker reads; the rest of the spec does not matter to it.
 */
export function blueprint(name: string, o: BlueprintOptions = {}): ClusterBlueprint {
  const cluster = {
    name: 'example',
    namespace: o.namespace ?? 'cf-clusters',
    kubernetes: { flavor: o.flavor ?? 'rke2', version: o.version ?? 'v1.35.9+rke2r1' },
    infrastructure: { provider: o.provider ?? 'openstack' },
  };
  return {
    name,
    spec: {
      displayName: o.displayName ?? `Cluster ${name}`,
      description: o.description ?? '',
      connection: o.connection ?? 'home',
      parameters: {
        workerCounts: [{ pool: 'default', min: 1, max: 3 }],
        machineSizes: [],
        ...(o.versions ? { kubernetesVersions: o.versions } : {}),
      },
      cluster: cluster as unknown as ClusterBlueprint['spec']['cluster'],
    },
    parametersSchema: parametersSchema(),
  };
}
