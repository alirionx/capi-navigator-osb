import { afterEach, describe, expect, it } from 'vitest';
import { startBroker, type TestBroker } from './support/broker.js';

describe('OpenAPI document and Swagger UI (OSB0-F-07, ADR-0006)', () => {
  let broker: TestBroker | undefined;
  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it('serves the OpenAPI 3.1 document without auth', async () => {
    broker = await startBroker();
    const res = await broker.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('CAPI Navigator Service Broker');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/healthz', '/readyz']));
    expect(doc.components.securitySchemes.brokerAuth).toMatchObject({
      type: 'http',
      scheme: 'basic',
    });
  });

  it('serves Swagger UI', async () => {
    broker = await startBroker();
    const res = await broker.app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('can be switched off', async () => {
    broker = await startBroker({ SWAGGER_UI_ENABLED: 'false' });
    expect((await broker.app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(404);
    expect((await broker.app.inject({ method: 'GET', url: '/docs/' })).statusCode).toBe(404);
  });
});
