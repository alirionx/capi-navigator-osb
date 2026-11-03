import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendOsbError } from './errors.js';

/** Oldest OSB API version the broker accepts (OSB0-F-03). */
export const MIN_API_VERSION = { major: 2, minor: 13 };

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/**
 * Guards every `/v2/*` endpoint (OSB0-F-03): basic auth with a constant-time comparison, then the
 * `X-Broker-API-Version` header (ADR-0004: missing → 400, unsupported → 412). Register it inside
 * the `/v2` scope so it also covers that scope's not-found handler.
 */
export function registerOsbGuard(
  scope: FastifyInstance,
  credentials: { username: string; password: string },
): void {
  const expectedUser = digest(credentials.username);
  const expectedPassword = digest(credentials.password);

  scope.addHook('onRequest', async (req, reply) => {
    const given = parseBasicAuth(req);
    // Both comparisons always run, so the timing does not tell which part was wrong.
    const userOk = timingSafeEqual(digest(given?.username ?? ''), expectedUser);
    const passwordOk = timingSafeEqual(digest(given?.password ?? ''), expectedPassword);
    if (!given || !userOk || !passwordOk) {
      reply.header('WWW-Authenticate', 'Basic realm="capi-navigator-osb", charset="UTF-8"');
      return sendOsbError(reply, 401, 'The broker credentials are missing or wrong.');
    }

    const version = req.headers['x-broker-api-version'];
    if (version === undefined || version === '') {
      return sendOsbError(reply, 400, 'The header X-Broker-API-Version is required.');
    }
    const match = /^(\d+)\.(\d+)$/.exec(String(version).trim());
    const major = Number(match?.[1]);
    const minor = Number(match?.[2]);
    if (!match || major !== MIN_API_VERSION.major || minor < MIN_API_VERSION.minor) {
      return sendOsbError(
        reply,
        412,
        `The broker supports the Open Service Broker API ${MIN_API_VERSION.major}.${MIN_API_VERSION.minor} ` +
          `to 2.17; the platform sent version ${String(version).slice(0, 20)}.`,
      );
    }
  });
}

function parseBasicAuth(req: FastifyRequest): { username: string; password: string } | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return undefined;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return undefined;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
