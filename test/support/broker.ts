import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp, REDACT } from '../../src/app.js';
import { createCapiClient } from '../../src/capi/client.js';
import { loadConfig, type Config } from '../../src/config.js';
import { FAKE_TOKEN, FakeCapiNavigator } from './fake-capi-navigator.js';

export const BROKER_USER = 'cf-broker';
export const BROKER_PASSWORD = 'broker-password-for-tests';

export const basicAuth = (user = BROKER_USER, password = BROKER_PASSWORD) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/** Headers of a valid OSB request. */
export const osbHeaders = (extra: Record<string, string> = {}) => ({
  authorization: basicAuth(),
  'x-broker-api-version': '2.17',
  ...extra,
});

export interface TestBroker {
  app: FastifyInstance;
  fake: FakeCapiNavigator;
  config: Config;
  /** Raw log lines written by the broker. */
  logs: string[];
  close(): Promise<void>;
}

/** A broker against a fresh fake of CAPI Navigator, with its log captured. */
export async function startBroker(
  env: Record<string, string> = {},
  options: { token?: string } = {},
): Promise<TestBroker> {
  const fake = new FakeCapiNavigator();
  const url = await fake.start();
  const config = loadConfig({
    CAPIN_URL: url,
    CAPIN_CONNECTION: 'home',
    CAPIN_TOKEN: FAKE_TOKEN,
    BROKER_USERNAME: BROKER_USER,
    BROKER_PASSWORD,
    LOG_LEVEL: 'debug',
    ...env,
  });
  const capi = createCapiClient({
    url: config.capi.url,
    token: options.token ?? config.capi.token,
    timeoutMs: 2000,
  });
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      done();
    },
  });
  const app = await buildApp({
    config,
    capi,
    logger: { level: config.logLevel, redact: REDACT, stream },
  });
  await app.ready();
  return {
    app,
    fake,
    config,
    logs,
    async close() {
      await app.close();
      await fake.stop();
    },
  };
}
