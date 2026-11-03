import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { basicAuth, osbHeaders, startBroker, type TestBroker } from './support/broker.js';

describe('OSB guard of /v2 (OSB0-F-03, ADR-0004)', () => {
  let broker: TestBroker;
  beforeAll(async () => {
    broker = await startBroker();
  });
  afterAll(() => broker.close());

  const get = (headers: Record<string, string>) =>
    broker.app.inject({ method: 'GET', url: '/v2/catalog', headers });

  it.each([
    ['no credentials', {}],
    ['a wrong password', { authorization: basicAuth('cf-broker', 'wrong') }],
    ['a wrong username', { authorization: basicAuth('someone', 'broker-password-for-tests') }],
    ['another scheme', { authorization: 'Bearer abc' }],
    ['a header without colon', { authorization: `Basic ${Buffer.from('x').toString('base64')}` }],
  ])('answers 401 for %s', async (_case, headers) => {
    const res = await get({ 'x-broker-api-version': '2.17', ...headers });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(res.json()).toEqual({ description: expect.any(String) });
  });

  it('checks the credentials before the version header', async () => {
    const res = await get({});
    expect(res.statusCode).toBe(401);
  });

  it('answers 400 without X-Broker-API-Version', async () => {
    const res = await get({ authorization: basicAuth() });
    expect(res.statusCode).toBe(400);
    expect(res.json().description).toContain('X-Broker-API-Version');
  });

  it.each(['2.12', '1.17', '3.0', 'latest', '2'])('answers 412 for version %s', async (v) => {
    const res = await get(osbHeaders({ 'x-broker-api-version': v }));
    expect(res.statusCode).toBe(412);
    expect(res.json().description).toContain('2.13');
  });

  it.each(['2.13', '2.17', '2.18'])('accepts version %s', async (v) => {
    const res = await get(osbHeaders({ 'x-broker-api-version': v }));
    // No /v2 route exists before OSB-1: the guarded not-found handler answers.
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ description: 'This endpoint does not exist.' });
  });

  it('echoes X-Broker-API-Request-Identity', async () => {
    const id = 'e26cea7c-2b9d-4b4f-9b5a-6f1f7b6a0c11';
    const res = await get(osbHeaders({ 'x-broker-api-request-identity': id }));
    expect(res.headers['x-broker-api-request-identity']).toBe(id);
    const unauthorized = await get({ 'x-broker-api-request-identity': id });
    expect(unauthorized.headers['x-broker-api-request-identity']).toBe(id);
  });

  it('does not guard the probes', async () => {
    const res = await broker.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
});
