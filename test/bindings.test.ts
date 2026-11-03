import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serverOf } from '../src/osb/bindings.js';
import { uuidV5 } from '../src/osb/uuid.js';
import { blueprint } from './support/blueprints.js';
import { osbHeaders, startBroker, type TestBroker } from './support/broker.js';

const OFFERING_ID = '0b0c9e40-7db5-45ae-a810-f4459a2fad3b';
const PLAN_ID = uuidV5('small', OFFERING_ID);
const INSTANCE = '5a8b1e4c-0d3f-4c2a-9b7e-1f2d3c4b5a69';
const BINDING = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const CLUSTER = 'cf-5a8b1e4c0d3f4c2a9b7e1f2d3c4b5a69';
const SECRET = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tc2VjcmV0LWtleS1mb3ItdGVzdHM=';
const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
  - name: ${CLUSTER}
    cluster:
      certificate-authority-data: Q0E=
      server: https://10.0.0.71:6443
users:
  - name: ${CLUSTER}-admin
    user:
      client-key-data: ${SECRET}
contexts:
  - name: ${CLUSTER}
    context: { cluster: ${CLUSTER}, user: ${CLUSTER}-admin }
current-context: ${CLUSTER}
`;

describe('bind and unbind (OSB-3)', () => {
  let b: TestBroker;
  beforeEach(async () => {
    b = await startBroker();
    b.fake.blueprints.push(blueprint('small'));
    await b.app.inject({
      method: 'PUT',
      url: `/v2/service_instances/${INSTANCE}?accepts_incomplete=true`,
      headers: osbHeaders(),
      payload: { service_id: OFFERING_ID, plan_id: PLAN_ID },
    });
  });
  afterEach(() => b.close());

  const cluster = () => b.fake.cluster(CLUSTER)!;
  const ready = () => {
    cluster().summary.ready = true;
    cluster().kubeconfig = KUBECONFIG;
  };

  const bind = (
    payload: object = { service_id: OFFERING_ID, plan_id: PLAN_ID },
    binding = BINDING,
    instance = INSTANCE,
  ) =>
    b.app.inject({
      method: 'PUT',
      url: `/v2/service_instances/${instance}/service_bindings/${binding}`,
      headers: osbHeaders(),
      payload,
    });

  const unbind = (query = `?service_id=${OFFERING_ID}&plan_id=${PLAN_ID}`) =>
    b.app.inject({
      method: 'DELETE',
      url: `/v2/service_instances/${INSTANCE}/service_bindings/${BINDING}${query}`,
      headers: osbHeaders(),
    });

  it('hands out the kubeconfig of a ready cluster (OSB3-F-01)', async () => {
    ready();
    const res = await bind({
      service_id: OFFERING_ID,
      plan_id: PLAN_ID,
      app_guid: 'a-1',
      bind_resource: { app_guid: 'a-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      credentials: {
        kubeconfig: KUBECONFIG,
        server: 'https://10.0.0.71:6443',
        cluster: CLUSTER,
        namespace: 'cf-clusters',
      },
    });
    expect(b.fake.requests.at(-1)?.url).toBe(
      `/api/connections/home/clusters/cf-clusters/${CLUSTER}/kubeconfig`,
    );
  });

  it('answers a repeated bind with fresh credentials (OSB3-F-02)', async () => {
    ready();
    expect((await bind()).statusCode).toBe(201);
    cluster().kubeconfig = KUBECONFIG.replace('10.0.0.71', '10.0.0.72');
    const again = await bind();
    expect(again.statusCode).toBe(201);
    expect(again.json().credentials.server).toBe('https://10.0.0.72:6443');
  });

  it('omits server when the kubeconfig has none', async () => {
    ready();
    cluster().kubeconfig = 'apiVersion: v1\nkind: Config\n';
    const creds = (await bind()).json().credentials;
    expect(creds).not.toHaveProperty('server');
    expect(creds.cluster).toBe(CLUSTER);
  });

  it('answers 422 ConcurrencyError while the cluster is not ready or being deleted', async () => {
    const notReady = await bind();
    expect(notReady.statusCode).toBe(422);
    expect(notReady.json()).toMatchObject({
      error: 'ConcurrencyError',
      description: expect.stringContaining('not ready'),
    });
    ready();
    cluster().summary.deletion = { phase: 'cleanup', startedAt: 'now' };
    const deleting = await bind();
    expect(deleting.statusCode).toBe(422);
    expect(deleting.json().description).toContain('being deleted');
  });

  it('answers 422 ConcurrencyError while the kubeconfig is not available yet', async () => {
    cluster().summary.ready = true;
    const res = await bind();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'ConcurrencyError' });
  });

  it.each([
    ['an unknown instance', {}, BINDING, '0d1c2b3a-0000-4000-8000-000000000000', 'does not exist'],
    ['an instance ID that is no UUID', {}, BINDING, 'not-a-uuid', 'does not exist'],
    ['a binding ID that is no UUID', {}, 'not-a-uuid', INSTANCE, 'binding ID must be a UUID'],
    ['another service', { service_id: 'other' }, BINDING, INSTANCE, 'does not offer the service'],
    ['parameters', { parameters: { readOnly: true } }, BINDING, INSTANCE, 'take no parameters'],
  ])('answers 400 for %s', async (_case, extra, binding, instance, text) => {
    ready();
    const res = await bind(
      { service_id: OFFERING_ID, plan_id: PLAN_ID, ...extra },
      binding,
      instance,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().description).toContain(text);
  });

  it('accepts empty parameters', async () => {
    ready();
    expect(
      (await bind({ service_id: OFFERING_ID, plan_id: PLAN_ID, parameters: {} })).statusCode,
    ).toBe(201);
  });

  it('answers 500 when the app refuses the kubeconfig or is down', async () => {
    ready();
    b.fake.intercept = async ({ url }) =>
      url.endsWith('/kubeconfig')
        ? {
            status: 403,
            body: { statusCode: 403, message: 'Missing permission clusters.kubeconfig' },
          }
        : undefined;
    const refused = await bind();
    expect(refused.statusCode).toBe(500);
    expect(refused.json().description).toContain('refuses the token or a permission');

    b.fake.intercept = async ({ url }) =>
      url.endsWith('/kubeconfig')
        ? { status: 502, body: { statusCode: 502, message: 'Workload cluster unreachable' } }
        : undefined;
    expect((await bind()).json().description).toBe(
      'CAPI Navigator answered 502 while reading the kubeconfig: Workload cluster unreachable.',
    );

    b.fake.intercept = async ({ url }) => (url.endsWith('/kubeconfig') ? 'drop' : undefined);
    expect((await bind()).json().description).toBe(
      'CAPI Navigator is not reachable; try again later.',
    );
  });

  it('never logs the kubeconfig (OSB3-F-04)', async () => {
    ready();
    await bind();
    await bind();
    const all = b.logs.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('client-key-data');
  });

  it('unbinds with 200 {} and without calling the app (OSB3-F-03)', async () => {
    const calls = b.fake.requests.length;
    const res = await unbind();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    expect(b.fake.requests.length).toBe(calls);
  });

  it('answers 400 to an unbind without service_id and plan_id', async () => {
    expect((await unbind('')).statusCode).toBe(400);
  });

  it('describes bind and unbind in the OpenAPI document (ADR-0006)', async () => {
    const doc = (await b.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const path = doc.paths['/v2/service_instances/{instance_id}/service_bindings/{binding_id}'];
    expect(Object.keys(path).sort()).toEqual(['delete', 'put']);
  });
});

describe('serverOf', () => {
  it.each([
    ['    server: https://a.example.com:6443\n', 'https://a.example.com:6443'],
    ['server: "https://b:6443" # comment\n', 'https://b:6443'],
    ["  server: 'https://c:6443'\n", 'https://c:6443'],
    ['kind: Config\n', undefined],
  ])('reads %j', (kubeconfig, server) => {
    expect(serverOf(kubeconfig)).toBe(server);
  });
});
