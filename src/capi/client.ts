import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema.generated.js';

export type CapiClient = Client<paths>;
export type ClusterSummary = components['schemas']['ClusterSummary'];
export type ClusterStatus = components['schemas']['ClusterStatus'];
export type ClusterBlueprint = components['schemas']['ClusterBlueprint'];
export type ApiErrorBody = components['schemas']['ApiErrorBody'];

export interface CapiClientOptions {
  url: string;
  token: string;
  timeoutMs: number;
  /** Replaceable in tests. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Typed client of the CAPI Navigator REST API (OSB0-F-02), generated from its OpenAPI document at
 * the pinned commit (api/README.md). The token stays inside the client and is never logged.
 */
export function createCapiClient(options: CapiClientOptions): CapiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  return createClient<paths>({
    baseUrl: options.url,
    headers: { Authorization: `Bearer ${options.token}` },
    fetch: (request: Request) =>
      doFetch(request, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs)]),
      }),
  });
}
