import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { originatingUser } from '../src/osb/identity.js';
import { FAKE_TOKEN } from './support/fake-capi-navigator.js';
import {
  BROKER_PASSWORD,
  basicAuth,
  osbHeaders,
  startBroker,
  type TestBroker,
} from './support/broker.js';

const INSTANCE = '5a8b1e4c-0d3f-4c2a-9b7e-1f2d3c4b5a69';

const cfIdentity = (json: object) =>
  `cloudfoundry ${Buffer.from(JSON.stringify(json)).toString('base64')}`;

describe('request log (OSB0-F-05)', () => {
  let broker: TestBroker;
  beforeAll(async () => {
    broker = await startBroker();
  });
  afterAll(() => broker.close());

  const lines = () => broker.logs.map((l) => JSON.parse(l) as Record<string, unknown>);

  it('logs one line per OSB request with identity and result', async () => {
    await broker.app.inject({
      method: 'GET',
      url: `/v2/service_instances/${INSTANCE}/last_operation?operation=provision`,
      headers: osbHeaders({
        'x-broker-api-originating-identity': cfIdentity({ user_id: 'u-42' }),
        'x-broker-api-request-identity': 'r-1',
      }),
    });
    const line = lines().find((l) => l.msg === 'request' && l.requestId === 'r-1');
    expect(line).toMatchObject({
      level: 30,
      method: 'GET',
      path: `/v2/service_instances/${INSTANCE}/last_operation`,
      instanceId: INSTANCE,
      userId: 'u-42',
      statusCode: 200,
    });
  });

  it('logs probes only at debug level', async () => {
    await broker.app.inject({ method: 'GET', url: '/healthz' });
    const line = lines().find((l) => l.msg === 'request' && l.path === '/healthz');
    expect(line?.level).toBe(20);
  });

  it('never logs the token, the password or the authorization header', async () => {
    await broker.app.inject({ method: 'GET', url: '/v2/catalog', headers: osbHeaders() });
    await broker.app.inject({
      method: 'GET',
      url: '/v2/catalog',
      headers: {
        authorization: basicAuth('cf-broker', 'wrong-guess'),
        'x-broker-api-version': '2.17',
      },
    });
    await broker.app.inject({ method: 'GET', url: '/readyz' });
    const all = broker.logs.join('\n');
    expect(all).not.toContain(FAKE_TOKEN);
    expect(all).not.toContain(BROKER_PASSWORD);
    expect(all).not.toContain('wrong-guess');
    expect(all).not.toContain(basicAuth().slice(6));
  });
});

describe('originatingUser (OSB0-F-05)', () => {
  it('reads user_id of Cloud Foundry and username of Kubernetes', () => {
    expect(originatingUser(cfIdentity({ user_id: 'u-1' }))).toBe('u-1');
    expect(
      originatingUser(`kubernetes ${Buffer.from('{"username":"jane"}').toString('base64')}`),
    ).toBe('jane');
  });

  it.each([
    ['missing', undefined],
    ['several headers', ['a', 'b']],
    ['no value', 'cloudfoundry'],
    ['not JSON', 'cloudfoundry bm90IGpzb24='],
    ['not an object', `cloudfoundry ${Buffer.from('"x"').toString('base64')}`],
    ['no user', cfIdentity({ other: 1 })],
  ])('ignores %s', (_case, header) => {
    expect(originatingUser(header)).toBeUndefined();
  });
});
