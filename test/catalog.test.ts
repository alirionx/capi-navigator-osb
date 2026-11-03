import { afterEach, describe, expect, it } from 'vitest';
import { createCapiClient, type ClusterBlueprint } from '../src/capi/client.js';
import { CatalogService, matchesFilter } from '../src/osb/catalog.js';
import { uuidV5 } from '../src/osb/uuid.js';
import { blueprint, parametersSchema } from './support/blueprints.js';
import { osbHeaders, startBroker, type TestBroker } from './support/broker.js';

const OFFERING_ID = '0b0c9e40-7db5-45ae-a810-f4459a2fad3b';

describe('GET /v2/catalog (OSB-1)', () => {
  let broker: TestBroker | undefined;
  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  async function catalog(b: TestBroker) {
    return b.app.inject({ method: 'GET', url: '/v2/catalog', headers: osbHeaders() });
  }

  const blueprintCalls = (b: TestBroker) =>
    b.fake.requests.filter((r) => r.url === '/api/blueprints').length;

  it('offers one service with one plan per blueprint (OSB1-F-01, OSB1-F-02, OSB1-F-03)', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(
      blueprint('small', {
        displayName: 'Small cluster',
        description: 'One control plane node, up to three workers',
        versions: ['v1.35.9+rke2r1', 'v1.36.5+rke2r1'],
      }),
    );
    const res = await catalog(broker);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      services: [
        {
          id: OFFERING_ID,
          name: 'kubernetes-cluster',
          description: 'Kubernetes clusters from CAPI Navigator blueprints',
          tags: ['kubernetes', 'cluster-api'],
          bindable: true,
          plan_updateable: false,
          instances_retrievable: false,
          bindings_retrievable: false,
          metadata: { displayName: 'Kubernetes cluster', providerDisplayName: 'CAPI Navigator' },
          plans: [
            {
              id: uuidV5('small', OFFERING_ID),
              name: 'small',
              description: 'Small cluster',
              free: true,
              bindable: true,
              plan_updateable: false,
              maximum_polling_duration: 3600,
              metadata: {
                displayName: 'Small cluster',
                bullets: [
                  'One control plane node, up to three workers',
                  'Infrastructure: OpenStack',
                  'Kubernetes: RKE2 v1.35.9+rke2r1, v1.36.5+rke2r1',
                ],
              },
              schemas: { service_instance: { create: { parameters: parametersSchema() } } },
            },
          ],
        },
      ],
    });
  });

  it('passes the parametersSchema through unchanged, including $schema (OSB1-F-02)', async () => {
    broker = await startBroker();
    const bp = blueprint('small');
    bp.parametersSchema = { ...parametersSchema(7), 'x-extra': { nested: [1, { a: null }] } };
    broker.fake.blueprints.push(bp);
    const plan = (await catalog(broker)).json().services[0].plans[0];
    expect(plan.schemas.service_instance.create.parameters).toEqual(bp.parametersSchema);
  });

  it('names provider and distribution of each blueprint', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(
      blueprint('a', { provider: 'proxmox', flavor: 'kubeadm', version: 'v1.35.2' }),
      blueprint('b', { provider: 'aws', flavor: 'k0s', version: 'v1.35.8+k0s.1' }),
      blueprint('c', { provider: 'gcp' }),
      blueprint('d', { provider: 'future', flavor: 'other', version: 'v1.40.0' }),
    );
    const bullets = (await catalog(broker))
      .json()
      .services[0].plans.map((p: { metadata: { bullets: string[] } }) => p.metadata.bullets);
    expect(bullets).toEqual([
      ['Infrastructure: Proxmox VE', 'Kubernetes: kubeadm v1.35.2'],
      ['Infrastructure: AWS', 'Kubernetes: k0s v1.35.8+k0s.1'],
      ['Infrastructure: Google Cloud', 'Kubernetes: RKE2 v1.35.9+rke2r1'],
      ['Infrastructure: future', 'Kubernetes: other v1.40.0'],
    ]);
  });

  it('offers only blueprints of the configured connection, sorted by name', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(
      blueprint('zeta'),
      blueprint('other-connection', { connection: 'lab' }),
      blueprint('alpha'),
    );
    const names = (await catalog(broker))
      .json()
      .services[0].plans.map((p: { name: string }) => p.name);
    expect(names).toEqual(['alpha', 'zeta']);
  });

  it('applies the blueprint filter (OSB1-F-04)', async () => {
    broker = await startBroker({ BLUEPRINT_FILTER: 'small,cf-*' });
    broker.fake.blueprints.push(
      blueprint('small'),
      blueprint('large'),
      blueprint('cf-medium'),
      blueprint('cf-large'),
    );
    const names = (await catalog(broker))
      .json()
      .services[0].plans.map((p: { name: string }) => p.name);
    expect(names).toEqual(['cf-large', 'cf-medium', 'small']);
  });

  it('uses the configured offering, plan price and polling duration', async () => {
    broker = await startBroker({
      OFFERING_NAME: 'k8s',
      OFFERING_ID: '6f0c5f43-2a43-4d6e-9d0b-0d8a3c8e4b11',
      OFFERING_DESCRIPTION: 'Clusters',
      PLANS_FREE: 'false',
      MAX_POLLING_DURATION_SECONDS: '7200',
    });
    broker.fake.blueprints.push(blueprint('small'));
    const service = (await catalog(broker)).json().services[0];
    expect(service).toMatchObject({
      id: '6f0c5f43-2a43-4d6e-9d0b-0d8a3c8e4b11',
      name: 'k8s',
      description: 'Clusters',
    });
    expect(service.plans[0]).toMatchObject({
      id: uuidV5('small', '6f0c5f43-2a43-4d6e-9d0b-0d8a3c8e4b11'),
      free: false,
      maximum_polling_duration: 7200,
    });
  });

  it('answers an empty catalog when no blueprint matches', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(blueprint('elsewhere', { connection: 'lab' }));
    const res = await catalog(broker);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ services: [] });
  });

  it('caches the catalog (OSB1-F-05)', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(blueprint('small'));
    await catalog(broker);
    broker.fake.blueprints.push(blueprint('large'));
    const res = await catalog(broker);
    expect(res.json().services[0].plans).toHaveLength(1);
    expect(blueprintCalls(broker)).toBe(1);
  });

  it('loads again after the cache expired and shares one call between concurrent requests', async () => {
    broker = await startBroker({ CATALOG_CACHE_SECONDS: '0' });
    broker.fake.blueprints.push(blueprint('small'));
    await Promise.all([catalog(broker), catalog(broker), catalog(broker)]);
    expect(blueprintCalls(broker)).toBe(1);
    broker.fake.blueprints.push(blueprint('large'));
    const res = await catalog(broker);
    expect(res.json().services[0].plans).toHaveLength(2);
    expect(blueprintCalls(broker)).toBe(2);
  });

  it.each([
    [401, 'Not signed in', 'refuses the token of the broker'],
    [403, 'Forbidden', 'refuses the token of the broker'],
    [502, 'Home cluster not reachable', 'CAPI Navigator answered 502: Home cluster not reachable'],
  ])('answers 500 when CAPI Navigator answers %i', async (status, message, description) => {
    broker = await startBroker();
    broker.fake.failWith = { status, message };
    const res = await catalog(broker);
    expect(res.statusCode).toBe(500);
    expect(res.json().description).toContain(description);
  });

  it('answers 500 when CAPI Navigator is down, and serves no stale catalog', async () => {
    broker = await startBroker({ CATALOG_CACHE_SECONDS: '0' });
    broker.fake.blueprints.push(blueprint('small'));
    expect((await catalog(broker)).statusCode).toBe(200);
    await broker.fake.stop();
    const res = await catalog(broker);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      description: 'CAPI Navigator is not reachable; try again later.',
    });
  });

  it('does not cache errors', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(blueprint('small'));
    broker.fake.failWith = { status: 502, message: 'down' };
    expect((await catalog(broker)).statusCode).toBe(500);
    broker.fake.failWith = undefined;
    expect((await catalog(broker)).statusCode).toBe(200);
  });

  it('answers unexpected data of the app with a generic 500', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push({
      name: 'broken',
      spec: { connection: 'home' },
    } as ClusterBlueprint);
    const res = await catalog(broker);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ description: 'Internal broker error.' });
    expect(broker.logs.some((l) => l.includes('request failed'))).toBe(true);
  });

  it('appears in the OpenAPI document with basic auth and the version header (ADR-0006)', async () => {
    broker = await startBroker();
    const doc = (await broker.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const op = doc.paths['/v2/catalog'].get;
    expect(op.security).toEqual([{ brokerAuth: [] }]);
    expect(op.parameters).toContainEqual(
      expect.objectContaining({
        in: 'header',
        name: 'x-broker-api-version',
        required: true,
        schema: expect.objectContaining({ default: '2.17' }),
      }),
    );
  });
});

describe('planById (for OSB-2)', () => {
  let broker: TestBroker | undefined;
  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it('finds the blueprint of a plan', async () => {
    broker = await startBroker();
    broker.fake.blueprints.push(blueprint('small'), blueprint('lab', { connection: 'lab' }));
    const capi = createCapiClient({
      url: broker.config.capi.url,
      token: broker.config.capi.token,
      timeoutMs: 2000,
    });
    const service = new CatalogService(capi, broker.config, broker.app.log);
    expect((await service.planById(uuidV5('small', OFFERING_ID)))?.blueprint.name).toBe('small');
    expect(await service.planById(uuidV5('lab', OFFERING_ID))).toBeUndefined();
    expect(await service.planById('unknown')).toBeUndefined();
  });
});

describe('matchesFilter (OSB1-F-04)', () => {
  it.each([
    [[], 'any', true],
    [['small'], 'small', true],
    [['small'], 'smaller', false],
    [['cf-*'], 'cf-large', true],
    [['cf-*'], 'large', false],
    [['*'], 'anything', true],
  ])('filter %j and name %s → %s', (filter, name, expected) => {
    expect(matchesFilter(name, filter)).toBe(expected);
  });
});
