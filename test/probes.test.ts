import { afterEach, describe, expect, it } from 'vitest';
import { describeError } from '../src/probes.js';
import { startBroker, type TestBroker } from './support/broker.js';

describe('probes (OSB0-F-04)', () => {
  let broker: TestBroker | undefined;
  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it('/healthz answers without calling CAPI Navigator', async () => {
    broker = await startBroker();
    const res = await broker.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok' });
    expect(broker.fake.requests).toHaveLength(0);
  });

  it('/readyz checks CAPI Navigator with the token', async () => {
    broker = await startBroker();
    const res = await broker.app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(broker.fake.requests.map((r) => r.url)).toEqual(['/api/auth/me']);
  });

  it('/readyz answers 503 when the token is refused', async () => {
    broker = await startBroker({}, { token: 'capin_revoked' });
    const res = await broker.app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'unavailable',
      reason: 'CAPI Navigator does not accept the token',
    });
  });

  it('/readyz answers 503 for other errors of the app', async () => {
    broker = await startBroker();
    broker.fake.failWith = { status: 502, message: 'Home cluster not reachable' };
    const res = await broker.app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('CAPI Navigator answered 502');
  });

  it('/readyz answers 503 when CAPI Navigator is down', async () => {
    broker = await startBroker();
    await broker.fake.stop();
    const res = await broker.app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('CAPI Navigator is not reachable');
  });

  it('describes network errors by name, code and cause', () => {
    const cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:443' };
    const err = new TypeError('fetch failed', { cause });
    expect(describeError(err)).toEqual({
      name: 'TypeError',
      code: 'ECONNREFUSED',
      cause: 'connect ECONNREFUSED 10.0.0.1:443',
    });
    expect(describeError(new Error('x'))).toEqual({ name: 'Error' });
    expect(describeError('x')).toEqual({ name: 'string' });
  });
});
