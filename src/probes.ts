import type { FastifyInstance } from 'fastify';
import type { CapiClient } from './capi/client.js';

const ProbeStatus = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'unavailable'] },
    reason: { type: 'string' },
  },
  required: ['status'],
} as const;

/**
 * `/healthz` (the process runs) and `/readyz` (CAPI Navigator answers with the token), both
 * without auth (OSB0-F-04). `/readyz` calls `GET /api/auth/me`: unlike the public probes of the
 * app it also proves that the token is valid.
 */
export function registerProbes(app: FastifyInstance, capi: CapiClient): void {
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['Probes'],
        summary: 'Liveness: the broker process runs',
        response: { 200: ProbeStatus },
      },
    },
    async () => ({ status: 'ok' }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['Probes'],
        summary: 'Readiness: CAPI Navigator is reachable and accepts the token',
        response: { 200: ProbeStatus, 503: ProbeStatus },
      },
    },
    async (req, reply) => {
      try {
        const { response } = await capi.GET('/api/auth/me');
        if (response.ok) return { status: 'ok' };
        const reason =
          response.status === 401
            ? 'CAPI Navigator does not accept the token'
            : `CAPI Navigator answered ${response.status}`;
        req.log.warn({ capiStatus: response.status }, 'not ready');
        return reply.code(503).send({ status: 'unavailable', reason });
      } catch (err) {
        req.log.warn({ err: describeError(err) }, 'not ready');
        return reply
          .code(503)
          .send({ status: 'unavailable', reason: 'CAPI Navigator is not reachable' });
      }
    },
  );
}

/**
 * Name, cause code and cause message of a network error (e.g. `getaddrinfo ENOTFOUND host`). These
 * come from the network layer and name host and port only, never headers or the token.
 */
export function describeError(err: unknown): { name: string; code?: string; cause?: string } {
  if (!(err instanceof Error)) return { name: typeof err };
  const cause = (err as { cause?: { code?: unknown; message?: unknown } }).cause;
  return {
    name: err.name,
    ...(typeof cause?.code === 'string' ? { code: cause.code } : {}),
    ...(typeof cause?.message === 'string' ? { cause: cause.message } : {}),
  };
}
