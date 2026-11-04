import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  isLooselyReadable,
  loadConfig,
  type SecretFileWarning,
} from '../src/config.js';

const TOKEN = 'capin_secret-token-value';
const PASSWORD = 'broker-secret-password';

const base = {
  CAPIN_URL: 'https://capi-navigator.example.com/',
  CAPIN_CONNECTION: 'home',
  CAPIN_TOKEN: TOKEN,
  BROKER_USERNAME: 'broker',
  BROKER_PASSWORD: PASSWORD,
};

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig (OSB0-F-01)', () => {
  it('reads the required variables and applies the defaults of ADR-0003', () => {
    const c = loadConfig(base);
    expect(c).toEqual({
      port: 8080,
      host: '0.0.0.0',
      logLevel: 'info',
      capi: {
        url: 'https://capi-navigator.example.com',
        connection: 'home',
        token: TOKEN,
        timeoutMs: 15000,
      },
      broker: { username: 'broker', password: PASSWORD },
      offering: {
        name: 'kubernetes-cluster',
        id: '0b0c9e40-7db5-45ae-a810-f4459a2fad3b',
        description: 'Kubernetes clusters from CAPI Navigator blueprints',
      },
      labelPrefix: 'osb.capi-navigator.io',
      blueprintFilter: [],
      catalog: { plansFree: true, maxPollingDurationSeconds: 3600, cacheMs: 60000 },
      retryAfterSeconds: 30,
      swaggerUi: true,
    });
  });

  it('reads optional settings', () => {
    const c = loadConfig({
      ...base,
      PORT: '9000',
      LOG_LEVEL: 'debug',
      CAPIN_TIMEOUT_SECONDS: '5',
      OFFERING_NAME: 'k8s',
      OFFERING_ID: '6f0c5f43-2a43-4d6e-9d0b-0d8a3c8e4b11',
      LABEL_PREFIX: 'broker.example.com',
      BLUEPRINT_FILTER: ' small, cf-* ,',
      SWAGGER_UI_ENABLED: 'false',
      PLANS_FREE: 'no',
      MAX_POLLING_DURATION_SECONDS: '7200',
      CATALOG_CACHE_SECONDS: '0',
    });
    expect(c.port).toBe(9000);
    expect(c.logLevel).toBe('debug');
    expect(c.capi.timeoutMs).toBe(5000);
    expect(c.offering.name).toBe('k8s');
    expect(c.labelPrefix).toBe('broker.example.com');
    expect(c.blueprintFilter).toEqual(['small', 'cf-*']);
    expect(c.swaggerUi).toBe(false);
    expect(c.catalog).toEqual({ plansFree: false, maxPollingDurationSeconds: 7200, cacheMs: 0 });
  });

  it('names every missing variable', () => {
    const problems = problemsOf({});
    for (const v of ['CAPIN_URL', 'CAPIN_CONNECTION', 'BROKER_USERNAME']) {
      expect(problems.some((p) => p.startsWith(`${v}:`))).toBe(true);
    }
  });

  it('requires the token and the password, directly or as file', () => {
    const problems = problemsOf({ ...base, CAPIN_TOKEN: undefined, BROKER_PASSWORD: undefined });
    expect(problems).toEqual([
      'CAPIN_TOKEN: required (or CAPIN_TOKEN_FILE)',
      'BROKER_PASSWORD: required (or BROKER_PASSWORD_FILE)',
    ]);
  });

  it('refuses a secret given twice', () => {
    expect(problemsOf({ ...base, CAPIN_TOKEN_FILE: '/run/token' })).toEqual([
      'CAPIN_TOKEN and CAPIN_TOKEN_FILE: set only one of both',
    ]);
  });

  it('reads secrets from files and warns about loose file modes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osb-config-'));
    const tokenFile = join(dir, 'token');
    const passwordFile = join(dir, 'password');
    writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
    writeFileSync(passwordFile, PASSWORD, { mode: 0o644 });
    const warnings: SecretFileWarning[] = [];
    const c = loadConfig(
      {
        ...base,
        CAPIN_TOKEN: undefined,
        CAPIN_TOKEN_FILE: tokenFile,
        BROKER_PASSWORD: undefined,
        BROKER_PASSWORD_FILE: passwordFile,
      },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(c.capi.token).toBe(TOKEN);
    expect(c.broker.password).toBe(PASSWORD);
    expect(warnings).toEqual([{ path: passwordFile, message: expect.stringContaining('600') }]);
  });

  it('accepts a secret file readable by its own group, as Kubernetes mounts it with fsGroup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osb-config-'));
    const tokenFile = join(dir, 'token');
    writeFileSync(tokenFile, TOKEN, { mode: 0o640 });
    const warnings: SecretFileWarning[] = [];
    loadConfig(
      { ...base, CAPIN_TOKEN: undefined, CAPIN_TOKEN_FILE: tokenFile },
      { onWarning: (w) => warnings.push(w) },
    );
    expect(warnings).toEqual([]);
  });

  it.each([
    [0o600, 1000, false],
    [0o440, 1000, false],
    [0o440, 2000, true],
    [0o604, 1000, true],
    [0o400, 2000, false],
  ])('judges mode %o with group %i for a process in group 1000', (mode, gid, loose) => {
    expect(isLooselyReadable(mode, gid, [1000])).toBe(loose);
  });

  it('reports unreadable and empty secret files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'osb-config-'));
    const empty = join(dir, 'empty');
    writeFileSync(empty, '\n', { mode: 0o600 });
    expect(
      problemsOf({
        ...base,
        CAPIN_TOKEN: undefined,
        CAPIN_TOKEN_FILE: join(dir, 'missing'),
        BROKER_PASSWORD: undefined,
        BROKER_PASSWORD_FILE: empty,
      }),
    ).toEqual([
      'CAPIN_TOKEN_FILE: the file cannot be read',
      'BROKER_PASSWORD_FILE: the file is empty',
    ]);
  });

  it.each([
    ['capi-navigator.io', 'reserved by CAPI Navigator'],
    ['cluster.x-k8s.io', 'reserved by CAPI Navigator'],
    ['osb-broker/', 'a DNS subdomain'],
    ['Upper.example.com', 'a DNS subdomain'],
  ])('refuses the label prefix %s (ADR-0003)', (prefix, reason) => {
    const problems = problemsOf({ ...base, LABEL_PREFIX: prefix });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('LABEL_PREFIX');
    expect(problems[0]).toContain(reason);
  });

  it('refuses invalid values without echoing them', () => {
    const problems = problemsOf({
      ...base,
      CAPIN_URL: 'ftp://capin_leaked@example.com',
      PORT: 'abc',
      OFFERING_ID: 'not-a-uuid',
      SWAGGER_UI_ENABLED: 'maybe',
    });
    expect(problems.map((p) => p.split(':')[0]).sort()).toEqual([
      'CAPIN_URL',
      'OFFERING_ID',
      'PORT',
      'SWAGGER_UI_ENABLED',
    ]);
    expect(problems.join('\n')).not.toContain('capin_leaked');
  });

  it('never puts secrets into the error message', () => {
    try {
      loadConfig({ ...base, CAPIN_TOKEN_FILE: '/x', BROKER_USERNAME: '' });
    } catch (e) {
      expect(String(e)).not.toContain(TOKEN);
      expect(String(e)).not.toContain(PASSWORD);
      return;
    }
    throw new Error('expected a ConfigError');
  });
});
