import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema.generated.js';

export type CapiClient = Client<paths>;
export type ClusterSummary = components['schemas']['ClusterSummary'];
export type ClusterStatus = components['schemas']['ClusterStatus'];
export type ClusterBlueprint = components['schemas']['ClusterBlueprint'];
export type ApiErrorBody = components['schemas']['ApiErrorBody'];

export const DELETE_TIMEOUT_MS = 45_000;

/** True for the error of a request that ran into its timeout. */
export const isTimeout = (err: unknown) => err instanceof Error && err.name === 'TimeoutError';

export interface CapiClientOptions {
  url: string;
  token: string;
  timeoutMs: number;
  /**
   * Timeout of `POST …/delete`, which can block while the cleanup starts (ADR-0008, CNR-05).
   * Default 45 s, below the 60 s the Cloud Controller waits for the broker.
   */
  deleteTimeoutMs?: number;
  /** Replaceable in tests. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Typed client of the CAPI Navigator REST API (OSB0-F-02), generated from its OpenAPI document at
 * the pinned commit (api/README.md). The token stays inside the client and is never logged.
 */
export function createCapiClient(options: CapiClientOptions): CapiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const deleteTimeoutMs = options.deleteTimeoutMs ?? DELETE_TIMEOUT_MS;
  return createClient<paths>({
    baseUrl: options.url,
    headers: { Authorization: `Bearer ${options.token}` },
    fetch: (request: Request) => {
      const isDelete =
        request.method === 'POST' && new URL(request.url).pathname.endsWith('/delete');
      const ms = isDelete ? deleteTimeoutMs : options.timeoutMs;
      return doFetch(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(ms)]),
      });
    },
  });
}
