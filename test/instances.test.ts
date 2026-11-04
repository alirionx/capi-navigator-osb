import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appDescription, canonicalJson, clusterName, paramsHash } from '../src/osb/instances.js';
import { uuidV5 } from '../src/osb/uuid.js';
import { blueprint } from './support/blueprints.js';
import { osbHeaders, startBroker, type TestBroker } from './support/broker.js';

const OFFERING_ID = '0b0c9e40-7db5-45ae-a810-f4459a2fad3b';
const PLAN_ID = uuidV5('small', OFFERING_ID);
const INSTANCE = '5A8B1E4C-0D3F-4C2A-9B7E-1F2D3C4B5A69'.toLowerCase();
const CLUSTER = 'cf-5a8b1e4c0d3f4c2a9b7e1f2d3c4b5a69';
const ORG = 'c3b4a5d6-0000-4000-8000-000000000001';
const SPACE = 'c3b4a5d6-0000-4000-8000-000000000002';
const PREFIX = 'osb.capi-navigator.io';

const provisionBody = (parameters?: Record<string, unknown>, planId = PLAN_ID) => ({
  service_id: OFFERING_ID,
  plan_id: planId,
  ...(parameters ? { parameters } : {}),
  context: { platform: 'cloudfoundry', organization_guid: ORG, space_guid: SPACE },
});

describe('service instances (OSB-2)', () => {
  let b: TestBroker;
  beforeEach(async () => {
    b = await startBroker();
    b.fake.blueprints.push(blueprint('small'));
  });
  afterEach(() => b.close());

  const provision = (
    body: object = provisionBody(),
    query = '?accepts_incomplete=true',
    id = INSTANCE,
  ) =>
    b.app.inject({
      method: 'PUT',
      url: `/v2/service_instances/${id}${query}`,
      headers: osbHeaders(),
      payload: body,
    });

  const deprovision = (
    query = `?accepts_incomplete=true&service_id=${OFFERING_ID}&plan_id=${PLAN_ID}`,
    id = INSTANCE,
  ) =>
    b.app.inject({
      method: 'DELETE',
      url: `/v2/service_instances/${id}${query}`,
      headers: osbHeaders(),
    });

  const lastOperation = (operation?: string, id = INSTANCE) =>
    b.app.inject({
      method: 'GET',
      url: `/v2/service_instances/${id}/last_operation${operation ? `?operation=${operation}` : ''}`,
      headers: osbHeaders(),
    });

  const capiCalls = () => b.fake.requests.filter((r) => r.url !== '/api/blueprints').length;

  describe('provision', () => {
    it('creates the cluster from the blueprint with name, parameters and labels (OSB2-F-02, OSB2-F-04)', async () => {
      const parameters = { workerPools: { default: { replicas: 2 } } };
      const res = await provision(provisionBody(parameters));
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ operation: 'provision' });
      const create = b.fake.requests.find((r) => r.method === 'POST');
      expect(create?.url).toBe('/api/blueprints/small/clusters');
      expect(create?.body).toEqual({
        name: CLUSTER,
        parameters,
        labels: {
          [`${PREFIX}/instance-id`]: INSTANCE,
          [`${PREFIX}/params-hash`]: paramsHash(PLAN_ID, parameters),
          [`${PREFIX}/org-guid`]: ORG,
          [`${PREFIX}/space-guid`]: SPACE,
        },
      });
      // NF-02: lookup, (catalog) and create.
      expect(capiCalls()).toBe(2);
    });

    it('takes org and space from the deprecated top-level fields and skips invalid ones', async () => {
      await provision({
        service_id: OFFERING_ID,
        plan_id: PLAN_ID,
        organization_guid: ORG,
        space_guid: 'not a valid label value!',
      });
      const labels = (b.fake.requests.find((r) => r.method === 'POST')?.body as { labels: object })
        .labels;
      expect(labels).toEqual({
        [`${PREFIX}/instance-id`]: INSTANCE,
        [`${PREFIX}/params-hash`]: paramsHash(PLAN_ID, undefined),
        [`${PREFIX}/org-guid`]: ORG,
      });
    });

    it('answers 422 AsyncRequired without accepts_incomplete=true (OSB2-F-01)', async () => {
      for (const query of ['', '?accepts_incomplete=false']) {
        const res = await provision(provisionBody(), query);
        expect(res.statusCode).toBe(422);
        expect(res.json()).toMatchObject({ error: 'AsyncRequired' });
      }
      expect(capiCalls()).toBe(0);
    });

    it.each([
      ['an instance ID that is no UUID', provisionBody(), 'not-a-uuid', 'must be a UUID'],
      [
        'another service',
        { ...provisionBody(), service_id: 'other' },
        INSTANCE,
        'does not offer the service',
      ],
      [
        'an unknown plan',
        provisionBody(undefined, 'unknown-plan'),
        INSTANCE,
        'does not offer the plan',
      ],
      ['a body without plan_id', { service_id: OFFERING_ID }, INSTANCE, 'plan_id'],
    ])('answers 400 for %s', async (_case, body, id, text) => {
      const res = await provision(body, '?accepts_incomplete=true', id);
      expect(res.statusCode).toBe(400);
      expect(res.json().description).toContain(text);
      expect(b.fake.requests.some((r) => r.method === 'POST')).toBe(false);
    });

    it('answers a repeated request: 202 while in progress, 200 when ready (OSB2-F-02)', async () => {
      const params = { workerPools: { default: { replicas: 2 } } };
      expect((await provision(provisionBody(params))).statusCode).toBe(202);
      // Same parameters in another key order and format.
      const again = await provision(
        provisionBody(JSON.parse('{"workerPools":{"default":{"replicas":2}}}')),
      );
      expect(again.statusCode).toBe(202);
      expect(again.json()).toEqual({ operation: 'provision' });
      b.fake.cluster(CLUSTER)!.summary.ready = true;
      const ready = await provision(provisionBody(params));
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({});
      expect(b.fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    });

    it('answers 409 for the same ID with other parameters or plan (OSB2-F-02)', async () => {
      b.fake.blueprints.push(blueprint('large'));
      await provision(provisionBody({ workerPools: { default: { replicas: 2 } } }));
      const other = await provision(provisionBody({ workerPools: { default: { replicas: 3 } } }));
      expect(other.statusCode).toBe(409);
      const otherPlan = await provision(
        provisionBody({ workerPools: { default: { replicas: 2 } } }, uuidV5('large', OFFERING_ID)),
      );
      expect(otherPlan.statusCode).toBe(409);
    });

    it('answers 409 for an instance that is being deleted', async () => {
      await provision();
      b.fake.cluster(CLUSTER)!.summary.deletion = { phase: 'deleting', startedAt: 'now' };
      const res = await provision();
      expect(res.statusCode).toBe(409);
      expect(res.json().description).toContain('being deleted');
    });

    it('passes invalid parameters on as 400 with the field errors (OSB2-F-03)', async () => {
      b.fake.intercept = async ({ method }) =>
        method === 'POST'
          ? {
              status: 400,
              body: {
                statusCode: 400,
                message: 'The input is invalid',
                hint: 'Correct the marked fields.',
                fieldErrors: {
                  'parameters.workerPools.default.replicas': ['Too big: expected <=3'],
                },
              },
            }
          : undefined;
      const res = await provision(provisionBody({ workerPools: { default: { replicas: 9 } } }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        description:
          'The input is invalid (parameters.workerPools.default.replicas: Too big: expected <=3). Correct the marked fields.',
      });
    });

    it('answers 400 with message and hint for a blocker of the app (ADR-0004)', async () => {
      b.fake.intercept = async ({ method }) =>
        method === 'POST'
          ? {
              status: 409,
              body: {
                statusCode: 409,
                message: 'The address pool of blueprint small is exhausted',
                hint: 'Delete a cluster or ask an admin to extend the pool.',
              },
            }
          : undefined;
      const res = await provision();
      expect(res.statusCode).toBe(400);
      expect(res.json().description).toBe(
        'The address pool of blueprint small is exhausted. Delete a cluster or ask an admin to extend the pool.',
      );
      expect(res.json()).not.toHaveProperty('error');
    });

    it('treats a 409 as a concurrent create when the instance exists afterwards (ADR-0004)', async () => {
      b.fake.intercept = async ({ method }) => {
        if (method !== 'POST') return undefined;
        b.fake.clusters.push({
          connection: 'home',
          summary: {
            name: CLUSTER,
            namespace: 'cf-clusters',
            phase: 'Provisioning',
            ready: false,
            managed: true,
            labels: {
              [`${PREFIX}/instance-id`]: INSTANCE,
              [`${PREFIX}/params-hash`]: paramsHash(PLAN_ID, undefined),
            },
          },
        });
        return {
          status: 409,
          body: { statusCode: 409, message: `Cluster ${CLUSTER} already exists` },
        };
      };
      const res = await provision();
      expect(res.statusCode).toBe(202);
      expect(capiCalls()).toBe(3); // NF-02: lookup, create, lookup
    });

    it('answers 400 when the blueprint was deleted after the catalog was loaded', async () => {
      await b.app.inject({ method: 'GET', url: '/v2/catalog', headers: osbHeaders() });
      b.fake.blueprints.length = 0;
      const res = await provision();
      expect(res.statusCode).toBe(400);
      expect(res.json().description).toContain('no longer available');
    });

    it.each([
      [401, 'refuses the token'],
      [502, 'CAPI Navigator answered 502 while creating the cluster: Home cluster not reachable.'],
    ])('answers 500 when the create call fails with %i', async (status, text) => {
      b.fake.intercept = async ({ method }) =>
        method === 'POST'
          ? { status, body: { statusCode: status, message: 'Home cluster not reachable' } }
          : undefined;
      const res = await provision();
      expect(res.statusCode).toBe(500);
      expect(res.json().description).toContain(text);
    });

    it('answers 500 when the lookup fails or the catalog is unavailable', async () => {
      b.fake.failWith = { status: 503, message: 'Maintenance' };
      const lookup = await provision();
      expect(lookup.statusCode).toBe(500);
      expect(lookup.json().description).toContain('while looking up the instance: Maintenance');

      b.fake.failWith = undefined;
      b.fake.intercept = async ({ url }) =>
        url === '/api/blueprints'
          ? { status: 502, body: { statusCode: 502, message: 'down' } }
          : undefined;
      const catalog = await provision();
      expect(catalog.statusCode).toBe(500);
      expect(catalog.json().description).toContain('CAPI Navigator answered 502');
    });

    it('answers 500 when CAPI Navigator is down', async () => {
      await b.fake.stop();
      const res = await provision();
      expect(res.statusCode).toBe(500);
      expect(res.json().description).toBe('CAPI Navigator is not reachable; try again later.');
    });
  });

  describe('last operation (OSB2-F-05, OSB2-F-07)', () => {
    beforeEach(async () => {
      await provision();
    });
    const summary = () => b.fake.cluster(CLUSTER)!.summary;

    it('reports progress with Retry-After', async () => {
      Object.assign(summary(), {
        phase: 'Provisioned',
        controlPlane: { replicas: 1, ready: 1 },
        workers: { replicas: 3, ready: 1 },
      });
      const res = await lastOperation('provision');
      expect(res.statusCode).toBe(200);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.json()).toEqual({
        state: 'in progress',
        description: 'Provisioned: control plane 1/1, workers 1/3 ready.',
      });
    });

    it('reports the phase alone when machine counts are missing', async () => {
      expect((await lastOperation('provision')).json()).toEqual({
        state: 'in progress',
        description: 'Provisioning.',
      });
    });

    it('reports success when the cluster is ready', async () => {
      summary().ready = true;
      expect((await lastOperation('provision')).json()).toEqual({
        state: 'succeeded',
        description: `Cluster ${CLUSTER} is ready.`,
      });
    });

    it('reports a failed cluster with the message of its first false condition (ADR-0005)', async () => {
      summary().phase = 'Failed';
      b.fake.cluster(CLUSTER)!.conditions = [
        { type: 'Ready', status: 'True' },
        { type: 'InfrastructureReady', status: 'False', message: 'Quota exceeded for instances' },
      ];
      expect((await lastOperation('provision')).json()).toEqual({
        state: 'failed',
        description: 'Creating the cluster failed: Quota exceeded for instances',
      });
    });

    it('reports a failed cluster without a message, also when the status cannot be read', async () => {
      summary().phase = 'Failed';
      expect((await lastOperation('provision')).json().description).toBe(
        'Creating the cluster failed (phase Failed).',
      );
      b.fake.intercept = async ({ url }) => (url.endsWith(`/${CLUSTER}`) ? 'drop' : undefined);
      expect((await lastOperation('provision')).json().state).toBe('failed');
    });

    it('reports failed when the cluster is missing or being deleted during provision', async () => {
      summary().deletion = { phase: 'cleanup', startedAt: 'now' };
      expect((await lastOperation('provision')).json()).toMatchObject({ state: 'failed' });
      b.fake.remove(CLUSTER);
      expect((await lastOperation('provision')).json()).toEqual({
        state: 'failed',
        description: expect.stringContaining('does not exist'),
      });
      expect((await lastOperation('provision', 'not-a-uuid')).json().state).toBe('failed');
    });

    it('follows a deprovision until the cluster is gone (410)', async () => {
      expect((await lastOperation('deprovision')).json()).toEqual({
        state: 'in progress',
        description: 'Deletion starting.',
      });
      summary().deletion = { phase: 'cleanup', startedAt: 'now' };
      expect((await lastOperation('deprovision')).json().description).toContain('load balancers');
      summary().deletion = { phase: 'deleting', startedAt: 'now' };
      expect((await lastOperation('deprovision')).json().description).toBe('Deleting the cluster.');
      b.fake.remove(CLUSTER);
      const gone = await lastOperation('deprovision');
      expect(gone.statusCode).toBe(410);
      expect(gone.json()).toEqual({});
    });

    it('reports a cleanup timeout as failed with a hint', async () => {
      summary().deletion = {
        phase: 'cleanup-timeout',
        startedAt: 'now',
        message: 'LB still there',
      };
      expect((await lastOperation('deprovision')).json()).toEqual({
        state: 'failed',
        description: expect.stringMatching(/timed out: LB still there\. Delete the service again/),
      });
      summary().deletion = { phase: 'cleanup-timeout', startedAt: 'now' };
      expect((await lastOperation('deprovision')).json().description).toMatch(
        /^The cleanup in the cluster timed out\. /,
      );
    });

    it('infers the operation when the platform sends none', async () => {
      expect((await lastOperation()).json().state).toBe('in progress');
      summary().deletion = { phase: 'deleting', startedAt: 'now' };
      expect((await lastOperation()).json().description).toBe('Deleting the cluster.');
    });

    it('uses the first cluster and warns when several carry the instance label', async () => {
      const copy = structuredClone(b.fake.cluster(CLUSTER)!);
      copy.summary.name = 'cf-copy';
      b.fake.clusters.push(copy);
      expect((await lastOperation('provision')).json().state).toBe('in progress');
      expect(b.logs.some((l) => l.includes('several clusters found'))).toBe(true);
    });

    it('answers 500 when the lookup fails', async () => {
      b.fake.failWith = { status: 401, message: 'Not signed in' };
      const res = await lastOperation('provision');
      expect(res.statusCode).toBe(500);
      expect(res.json().description).toContain('refuses the token');
    });
  });

  describe('deprovision (OSB2-F-06)', () => {
    it('deletes the cluster with cleanup', async () => {
      await provision();
      const res = await deprovision();
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ operation: 'deprovision' });
      const del = b.fake.requests.find((r) => r.url.endsWith('/delete'));
      expect(del?.url).toBe(`/api/connections/home/clusters/cf-clusters/${CLUSTER}/delete`);
      expect(del?.body).toEqual({ confirmName: CLUSTER, cleanup: true, skipDrain: false });
      expect(b.fake.cluster(CLUSTER)?.summary.deletion?.phase).toBe('cleanup');
    });

    it('answers 202 again while the deletion runs, without a second delete call', async () => {
      await provision();
      await deprovision();
      const again = await deprovision();
      expect(again.statusCode).toBe(202);
      expect(b.fake.requests.filter((r) => r.url.endsWith('/delete'))).toHaveLength(1);
    });

    it('answers 410 for an instance that does not exist', async () => {
      for (const id of [INSTANCE, 'not-a-uuid']) {
        const res = await deprovision(undefined, id);
        expect(res.statusCode).toBe(410);
        expect(res.json()).toEqual({});
      }
    });

    it('answers 410 when the cluster vanishes before the delete call', async () => {
      await provision();
      b.fake.intercept = async ({ url }) =>
        url.endsWith('/delete')
          ? { status: 404, body: { statusCode: 404, message: 'gone' } }
          : undefined;
      expect((await deprovision()).statusCode).toBe(410);
    });

    it('answers 422 AsyncRequired without accepts_incomplete=true (OSB2-F-01)', async () => {
      const res = await deprovision(`?service_id=${OFFERING_ID}&plan_id=${PLAN_ID}`);
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('AsyncRequired');
    });

    it('answers 400 without service_id and plan_id', async () => {
      expect((await deprovision('?accepts_incomplete=true')).statusCode).toBe(400);
    });

    it('answers 400 with message and hint when the app refuses the deletion', async () => {
      await provision();
      b.fake.intercept = async ({ url }) =>
        url.endsWith('/delete')
          ? {
              status: 409,
              body: {
                statusCode: 409,
                message: 'The cluster hosts tenants',
                hint: 'Delete the tenants first.',
              },
            }
          : undefined;
      const res = await deprovision();
      expect(res.statusCode).toBe(400);
      expect(res.json().description).toBe('The cluster hosts tenants. Delete the tenants first.');
    });

    it('answers 500 for other errors and when CAPI Navigator is down', async () => {
      await provision();
      b.fake.intercept = async ({ url }) =>
        url.endsWith('/delete')
          ? { status: 502, body: { statusCode: 502, message: 'x' } }
          : undefined;
      expect((await deprovision()).statusCode).toBe(500);
      b.fake.intercept = async ({ url }) => (url.endsWith('/delete') ? 'drop' : undefined);
      const down = await deprovision();
      expect(down.statusCode).toBe(500);
      expect(down.json().description).toBe('CAPI Navigator is not reachable; try again later.');
    });
  });

  it('refuses updates with 422 (OSB2-F-08)', async () => {
    const res = await b.app.inject({
      method: 'PATCH',
      url: `/v2/service_instances/${INSTANCE}`,
      headers: osbHeaders(),
      payload: { service_id: OFFERING_ID, plan_id: PLAN_ID },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().description).toContain('Updates are not supported');
  });

  it('describes all instance routes in the OpenAPI document (ADR-0006)', async () => {
    const doc = (await b.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const path = doc.paths['/v2/service_instances/{instance_id}'];
    expect(Object.keys(path).sort()).toEqual(['delete', 'patch', 'put']);
    expect(doc.paths['/v2/service_instances/{instance_id}/last_operation'].get).toBeDefined();
  });
});

describe('helpers (ADR-0008)', () => {
  it('derives the cluster name from the instance ID', () => {
    expect(clusterName('5A8B1E4C-0D3F-4C2A-9B7E-1F2D3C4B5A69')).toBe(CLUSTER);
    expect(CLUSTER).toHaveLength(35);
  });

  it('writes canonical JSON with sorted keys', () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: 'x' }], u: undefined })).toBe(
      '{"a":[{"c":"x","d":null}],"b":1}',
    );
  });

  it('hashes plan and parameters', () => {
    const h = paramsHash(PLAN_ID, { a: 1, b: 2 });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(paramsHash(PLAN_ID, { b: 2, a: 1 })).toBe(h);
    expect(paramsHash('other', { a: 1, b: 2 })).not.toBe(h);
    expect(paramsHash(PLAN_ID, undefined)).toBe(paramsHash(PLAN_ID, {}));
  });

  it('builds a description from the error body of the app', () => {
    expect(appDescription(undefined, 'fallback')).toBe('fallback');
    expect(appDescription({ statusCode: 409, message: 'Blocked.' }, 'f')).toBe('Blocked.');
    expect(appDescription({ statusCode: 409, message: 'Blocked.', hint: 'Wait.' }, 'f')).toBe(
      'Blocked. Wait.',
    );
  });

  it('names the violated limit of refused parameters (OSB4-F-03)', () => {
    expect(
      appDescription(
        {
          statusCode: 400,
          message: 'The request does not fit the blueprint',
          details: 'parameters.workerPools.default.replicas: Too big: expected number to be <=5',
        },
        'f',
      ),
    ).toBe(
      'The request does not fit the blueprint. parameters.workerPools.default.replicas: Too big: expected number to be <=5',
    );
  });
});
