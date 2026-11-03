import type { FastifyBaseLogger } from 'fastify';
import type { ApiErrorBody } from '../capi/client.js';
import { describeError } from '../probes.js';
import { OsbFailure } from './errors.js';

export const UNREACHABLE = 'CAPI Navigator is not reachable; try again later.';
const TOKEN_REFUSED =
  'CAPI Navigator refuses the token or a permission of the broker; ask the operator of the broker.';

/** Runs a call to CAPI Navigator; a network error or timeout becomes a 500 for the platform. */
export async function callApp<T>(
  log: FastifyBaseLogger,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err: describeError(err), action }, 'CAPI Navigator not reachable');
    throw new OsbFailure(500, UNREACHABLE);
  }
}

/** An unexpected answer of CAPI Navigator as 500 with a description for the platform. */
export function appFailure(
  log: FastifyBaseLogger,
  action: string,
  status: number,
  error?: ApiErrorBody,
): OsbFailure {
  log.warn({ action, capiStatus: status, message: error?.message }, 'CAPI Navigator error');
  if (status === 401 || status === 403) return new OsbFailure(500, TOKEN_REFUSED);
  return new OsbFailure(
    500,
    `CAPI Navigator answered ${status} while ${action}${error?.message ? `: ${error.message}` : ''}.`,
  );
}
