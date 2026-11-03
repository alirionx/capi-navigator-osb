import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapiClient } from '../src/capi/client.js';
import { FAKE_TOKEN, FakeCapiNavigator } from './support/fake-capi-navigator.js';

describe('CAPI Navigator client (OSB0-F-02)', () => {
  let fake: FakeCapiNavigator;
  let url: string;

  beforeEach(async () => {
    fake = new FakeCapiNavigator();
    url = await fake.start();
  });
  afterEach(() => fake.stop());

  it('sends the token as bearer token', async () => {
    const client = createCapiClient({ url, token: FAKE_TOKEN, timeoutMs: 5000 });
    const { data, response } = await client.GET('/api/auth/me');
    expect(response.status).toBe(200);
    expect(data?.username).toBe('osb-broker');
    expect(fake.requests[0]?.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('passes labelSelector as query parameter (FP34-F-10, ADR-0005)', async () => {
    fake.clusters.push(
      {
        connection: 'home',
        summary: {
          name: 'a',
          namespace: 'ns',
          phase: 'Provisioned',
          ready: true,
          managed: true,
          labels: { 'osb.capi-navigator.io/instance-id': 'i-1' },
        },
      },
      {
        connection: 'home',
        summary: {
          name: 'b',
          namespace: 'ns',
          phase: 'Provisioned',
          ready: true,
          managed: true,
          labels: {},
        },
      },
    );
    const client = createCapiClient({ url, token: FAKE_TOKEN, timeoutMs: 5000 });
    const { data } = await client.GET('/api/connections/{connection}/clusters', {
      params: {
        path: { connection: 'home' },
        query: { labelSelector: 'osb.capi-navigator.io/instance-id=i-1' },
      },
    });
    expect(data?.map((c) => c.name)).toEqual(['a']);
    expect(fake.requests[0]?.url).toBe(
      '/api/connections/home/clusters?labelSelector=osb.capi-navigator.io%2Finstance-id%3Di-1',
    );
  });

  it('returns the error body of the app', async () => {
    const client = createCapiClient({ url, token: 'capin_wrong', timeoutMs: 5000 });
    const { error, response } = await client.GET('/api/blueprints');
    expect(response.status).toBe(401);
    expect(error).toEqual({ statusCode: 401, message: 'Not signed in' });
  });

  it('aborts a request after the timeout', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const client = createCapiClient({ url, token: FAKE_TOKEN, timeoutMs: 20, fetch: hanging });
    await expect(client.GET('/api/auth/me')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
