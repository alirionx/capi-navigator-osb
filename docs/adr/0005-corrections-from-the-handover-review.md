# ADR-0005: Corrections from the handover review

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-0 (affects OSB-1 to OSB-3)

## Context

The handover was checked against CAPI Navigator's `docs/api/openapi.json` and code on 2026-11-03
(commit `a891cca`, after v0.15.0). Some statements of the requirements do not match the app or
each other.

## Decisions

### 1. `view` cannot be limited

The OpenAPI marks `view` (blueprint list, cluster list, cluster status) with "This permission
needs an unlimited role assignment". The technical user therefore gets `view` without a scope and
can read all clusters of all connections; only `clusters.create`, `clusters.delete` and
`clusters.kubeconfig` are limited to the connection and namespace(s) of the blueprints. The
broker itself only reads the configured connection. The documentation (OSB4-F-02) states this.

### 2. `labelSelector` is missing from the OpenAPI document

`GET /api/connections/{connection}/clusters` accepts `labelSelector` (FP34-F-10, backend
`clusters.controller.ts`), but the OpenAPI document mentioned it only in the description, not as
a parameter (request CNR-01 in `docs/capi-navigator-requests.md`).

Update 2026-11-04: CAPI Navigator documents the parameter since commit `2d2faed`; the generated
client uses it directly, no hand-written extension is needed.

### 3. Failure message of a cluster

`ClusterSummary` has no message. For phase `Failed`, `last_operation` reads the cluster status
(`GET …/clusters/{namespace}/{name}`) once and uses the message of the first condition with
status `False` as description, or a generic text naming the phase if there is none. A cluster
that never becomes ready and never fails ends with `maximum_polling_duration` (OSB1-F-03), after
which Cloud Foundry marks the operation as failed.

### 4. Connection and namespace come from the blueprint

Each blueprint has its own `spec.connection`, and its namespace is `spec.cluster.namespace`. The
catalog offers only blueprints whose connection is the configured one (OSB1-F-01). The namespace
of an instance is taken from its cluster summary (`namespace`), found by label, for kubeconfig,
status and delete.

### 5. Supported release of CAPI Navigator

FP-34 is not released yet (latest tag v0.15.1 does not contain it; the OpenAPI document says
`0.0.0-dev`). Until the first release with FP-34, the client is generated from `openapi.json` at a
pinned commit of CAPI Navigator (`2d2faed`, recorded in `api/README.md`); the pin moves to the
release tag as soon as there is one (expected: 0.16.0; the hotfix 0.15.1 does not contain FP-34).

### 6. Number of app calls per request (NF-02)

NF-02 allowed one app call per OSB request, but provision, deprovision and bind need a lookup by
label first (OSB2-F-02, OSB2-F-06, OSB3-F-01), and ADR-0004 adds a second lookup after a `409`.
NF-02 now reads: a fixed, small number of app calls per OSB request (at most three), the catalog
from the cache, and no polling of its own.

## Consequences

- Section 2, OSB1-F-01, OSB2-F-05 and NF-02 of the requirements are adjusted.
- Two requests for the CAPI Navigator backlog are written down in
  `docs/capi-navigator-requests.md`.
