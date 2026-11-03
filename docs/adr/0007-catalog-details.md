# ADR-0007: Details of the catalog

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-1 (OSB1-F-01 to OSB1-F-05)

## Context

OSB-1 leaves a few details open: what the catalog looks like without blueprints, what the
bullets of a plan say, how the price and the cache are configured, and what happens when CAPI
Navigator cannot be reached.

Cloud Foundry reads `/v2/catalog` only for `cf create-service-broker` and
`cf update-service-broker`; `cf create-service` uses the catalog stored in the Cloud Controller.
The broker itself needs the catalog in OSB-2 to find the blueprint of a plan ID, right before it
calls CAPI Navigator to create the cluster.

## Decision

- **No stale catalog.** The catalog is cached for `CATALOG_CACHE_SECONDS` (default 60);
  concurrent requests share one call. If CAPI Navigator cannot be reached or refuses the call, the
  broker answers `500` with a description for the user and loads again on the next request.
  Errors are not cached. A stale catalog would not help (provisioning needs the app anyway) and
  could offer blueprints that were deleted in the meantime.
- **No blueprints, no offering.** The spec requires at least one plan per offering, so a catalog
  without matching blueprints is `{"services": []}`.
- **Plans** are sorted by blueprint name. `metadata.bullets`: the blueprint description (if any),
  `Infrastructure: <provider>` and `Kubernetes: <distribution> <versions>`, listing all versions
  the blueprint offers. The offering gets `metadata.displayName` "Kubernetes cluster" and
  `providerDisplayName` "CAPI Navigator".
- **Configuration:** `PLANS_FREE` (default `true`) sets `free` of all plans;
  `MAX_POLLING_DURATION_SECONDS` (default 3600) sets `maximum_polling_duration`.

## Consequences

- During an outage of CAPI Navigator, `cf update-service-broker` fails and Cloud Foundry keeps
  its stored catalog.
- A price per plan is not possible; all plans share `PLANS_FREE`.
