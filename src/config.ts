import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

/** Label prefixes CAPI Navigator refuses for user labels (its RESERVED_LABEL_PREFIXES, ADR-0003). */
const RESERVED_LABEL_PREFIXES = ['capi-navigator.io', 'cluster.x-k8s.io'];

/** A DNS subdomain as Kubernetes expects it for the prefix of a label key. */
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

const nonEmpty = z.string().trim().min(1);

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * The environment variables of the broker (OSB0-F-01). Secrets can be given directly or as a file
 * (`*_FILE`, e.g. a mounted Kubernetes Secret); exactly one of both.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: nonEmpty.default('0.0.0.0'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  CAPIN_URL: z.url({ protocol: /^https?$/ }),
  CAPIN_CONNECTION: nonEmpty,
  CAPIN_TOKEN: nonEmpty.optional(),
  CAPIN_TOKEN_FILE: nonEmpty.optional(),
  CAPIN_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(300).default(15),

  BROKER_USERNAME: nonEmpty,
  BROKER_PASSWORD: nonEmpty.optional(),
  BROKER_PASSWORD_FILE: nonEmpty.optional(),

  // Defaults of ADR-0003. The offering ID and the label prefix must not change after the first
  // instance: plan IDs derive from the offering ID, instances are found by their labels.
  OFFERING_NAME: z
    .string()
    .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens')
    .default('kubernetes-cluster'),
  OFFERING_ID: z.uuid().default('0b0c9e40-7db5-45ae-a810-f4459a2fad3b'),
  OFFERING_DESCRIPTION: nonEmpty.default('Kubernetes clusters from CAPI Navigator blueprints'),
  LABEL_PREFIX: z
    .string()
    .max(253)
    .regex(DNS_SUBDOMAIN, 'a DNS subdomain without a trailing slash')
    .refine((p) => !RESERVED_LABEL_PREFIXES.includes(p), 'reserved by CAPI Navigator')
    .default('osb.capi-navigator.io'),
  // OSB1-F-04: comma-separated blueprint names; an entry ending with * is a name prefix.
  BLUEPRINT_FILTER: z.string().optional(),
  PLANS_FREE: booleanFlag.default(true), // OSB1-F-02
  MAX_POLLING_DURATION_SECONDS: z.coerce.number().int().min(60).max(604800).default(3600), // OSB1-F-03
  CATALOG_CACHE_SECONDS: z.coerce.number().int().min(0).max(3600).default(60), // OSB1-F-05
  RETRY_AFTER_SECONDS: z.coerce.number().int().min(1).max(3600).default(30), // OSB2-F-07

  SWAGGER_UI_ENABLED: booleanFlag.default(true), // ADR-0006
});

export interface Config {
  port: number;
  host: string;
  logLevel: (typeof LOG_LEVELS)[number];
  capi: { url: string; connection: string; token: string; timeoutMs: number };
  broker: { username: string; password: string };
  offering: { name: string; id: string; description: string };
  labelPrefix: string;
  blueprintFilter: string[];
  catalog: { plansFree: boolean; maxPollingDurationSeconds: number; cacheMs: number };
  retryAfterSeconds: number;
  swaggerUi: boolean;
}

/** A configuration error that names variables, never their values. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface SecretFileWarning {
  path: string;
  message: string;
}

interface LoadOptions {
  /** Reads a secret file; replaceable in tests. */
  readSecretFile?: (path: string) => string;
  /** Called for a secret file that others than the owner can read. */
  onWarning?: (warning: SecretFileWarning) => void;
}

/** Reads and checks the configuration from environment variables (OSB0-F-01). */
export function loadConfig(env: NodeJS.ProcessEnv, options: LoadOptions = {}): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only the variable name and the rule; issue messages of Zod do not contain the input.
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'environment'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const problems: string[] = [];
  const read = options.readSecretFile ?? readSecretFile(options.onWarning);

  const secret = (name: string, value?: string, file?: string): string => {
    if (value && file) {
      problems.push(`${name} and ${name}_FILE: set only one of both`);
      return '';
    }
    if (file) {
      try {
        const content = read(file).trim();
        if (!content) problems.push(`${name}_FILE: the file is empty`);
        return content;
      } catch {
        problems.push(`${name}_FILE: the file cannot be read`);
        return '';
      }
    }
    if (!value) problems.push(`${name}: required (or ${name}_FILE)`);
    return value ?? '';
  };

  const token = secret('CAPIN_TOKEN', e.CAPIN_TOKEN, e.CAPIN_TOKEN_FILE);
  const password = secret('BROKER_PASSWORD', e.BROKER_PASSWORD, e.BROKER_PASSWORD_FILE);
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    capi: {
      url: e.CAPIN_URL.replace(/\/+$/, ''),
      connection: e.CAPIN_CONNECTION,
      token,
      timeoutMs: e.CAPIN_TIMEOUT_SECONDS * 1000,
    },
    broker: { username: e.BROKER_USERNAME, password },
    offering: { name: e.OFFERING_NAME, id: e.OFFERING_ID, description: e.OFFERING_DESCRIPTION },
    labelPrefix: e.LABEL_PREFIX,
    blueprintFilter: (e.BLUEPRINT_FILTER ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    catalog: {
      plansFree: e.PLANS_FREE,
      maxPollingDurationSeconds: e.MAX_POLLING_DURATION_SECONDS,
      cacheMs: e.CATALOG_CACHE_SECONDS * 1000,
    },
    retryAfterSeconds: e.RETRY_AFTER_SECONDS,
    swaggerUi: e.SWAGGER_UI_ENABLED,
  };
}

/**
 * Whether a secret file is open to other users: any access for others, or group access for a group
 * the process does not belong to. Group access for an own group is fine: Kubernetes mounts secrets
 * with fsGroup as 0440 owned by the pod's group, which only the broker's own process holds.
 */
export function isLooselyReadable(
  mode: number,
  gid: number,
  ownGroups: readonly number[],
): boolean {
  if ((mode & 0o007) !== 0) return true;
  return (mode & 0o070) !== 0 && !ownGroups.includes(gid);
}

function ownGroups(): number[] {
  return process.getgid && process.getgroups ? [process.getgid(), ...process.getgroups()] : [];
}

/** Reads a secret file and warns if users other than the broker's own may read it. */
function readSecretFile(onWarning?: (w: SecretFileWarning) => void) {
  return (path: string): string => {
    const { mode, gid } = statSync(path);
    if (onWarning && isLooselyReadable(mode, gid, ownGroups())) {
      onWarning({
        path,
        message: 'secret file is readable by other users; use mode 600, 400 or 440',
      });
    }
    return readFileSync(path, 'utf8');
  };
}
