# Requirements – CAPI Navigator Service Broker

Version 1 (2026-11-03). Status of the packs: see `CLAUDE.md`.

## 1. Goal

Cloud Foundry users order Kubernetes clusters with `cf create-service`, get the kubeconfig with
`cf bind-service` (or a service key) and remove the cluster with `cf delete-service`. The clusters
come from **cluster blueprints** of CAPI Navigator: an admin there reviews a cluster spec once and
offers a few parameters (number of workers, machine size, Kubernetes version). The broker adds
nothing of its own beyond the translation between both APIs.

**Simplicity is a requirement.** One service instance is one cluster. There are no updates, no
shared clusters and no state in the broker.

### Non-goals (first version)

- Plan changes and parameter updates (`plan_updateable: false`, no `maintenance_info`).
- Credentials with limited rights or that unbinding revokes: a binding hands out the cluster's
  admin kubeconfig. Rotating it means deleting the instance.
- Quotas per org or space (use plan visibility and quotas of Cloud Foundry).
- Retrieving instances or bindings (`instances_retrievable`, `bindings_retrievable`: false).
- A UI, other platforms than Cloud Foundry (Kubernetes Service Catalog), several CAPI Navigator
  installations per broker.

## 2. CAPI Navigator side (already built, FP-34)

The broker needs CAPI Navigator with FP-34 (first release after 0.15.0). Endpoints it uses; check
the exact schemas in CAPI Navigator's `docs/api/openapi.json`:

| Purpose    | Endpoint                                                                         |
| ---------- | -------------------------------------------------------------------------------- |
| Plans      | `GET /api/blueprints` (with `parametersSchema`, JSON Schema draft-04)            |
| Create     | `POST /api/blueprints/{blueprint}/clusters` `{name, parameters, labels}`         |
| Find       | `GET /api/connections/{connection}/clusters?labelSelector=…`                     |
| Status     | the cluster summary from the list (`phase`, `ready`, `deletion`, `blueprint`)    |
| Kubeconfig | `GET /api/connections/{c}/clusters/{ns}/{name}/kubeconfig` (text, audited)       |
| Delete     | `POST /api/connections/{c}/clusters/{ns}/{name}/delete` `{confirmName, cleanup}` |

Authentication: `Authorization: Bearer capin_…`, the token of a **technical user** with a role that
has `view`, `clusters.create`, `clusters.delete` and `clusters.kubeconfig`, limited to the
connection and namespace(s) of the offered blueprints. Every call is audited in CAPI Navigator under
this user and token name.

Behaviour of the app the broker relies on:

- A cluster from a blueprint carries the blueprint name (`blueprint` in the summary) and stays bound
  to it; nobody can change it except admins upgrading Kubernetes.
- Creating answers at once; the cluster becomes `ready` minutes later.
- Unknown parameters and values outside the limits: `400`. A cluster name that exists: `409`.
  Blockers (provider not ready, credential not allowed): `409` with message and hint.
- Deleting removes load balancers and volumes inside the cluster first; the summary shows
  `deletion.phase` (`cleanup`, `deleting`, `cleanup-timeout`) until the cluster is gone.

## 3. Architecture

```
Cloud Controller ──OSB API v2.17 (basic auth)──▶ Broker (stateless) ──REST + token──▶ CAPI Navigator
                                                                                      └─ Cluster API
```

- One service offering, configured by the operator (name, ID, description); defaults in
  [ADR-0003](adr/0003-offering-and-label-prefix-defaults.md).
- One plan per blueprint of the configured connection (optionally filtered, OSB1-F-04).
- Plan ID: UUID v5 of the offering ID and the blueprint name, so it stays stable.
- Cluster name of an instance: `cf-` followed by the instance ID without hyphens (35 characters;
  CAPI Navigator allows 40). The same instance ID always gives the same name.
- Labels set at creation, under a configurable prefix without the trailing slash (default
  `osb.capi-navigator.io`, [ADR-0003](adr/0003-offering-and-label-prefix-defaults.md); never
  `capi-navigator.io` or `cluster.x-k8s.io`, which the app refuses):

| Label                  | Value                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `<prefix>/instance-id` | OSB instance ID                                                                          |
| `<prefix>/org-guid`    | `context.organization_guid`                                                              |
| `<prefix>/space-guid`  | `context.space_guid`                                                                     |
| `<prefix>/params-hash` | first 32 hex characters of SHA-256 over plan ID and the canonical JSON of the parameters |

## 4. Packs

### OSB-0: Scaffold

- **OSB0-F-01** MUST read its configuration from environment variables, checked at startup:
  CAPI Navigator URL, connection, the app token (from a file or variable, never logged), broker
  username and password, offering name, ID and description, label prefix, optional blueprint
  filter, log level.
- **OSB0-F-02** MUST use a typed client for the CAPI Navigator API, generated from or checked
  against its `openapi.json` of the supported release.
- **OSB0-F-03** MUST protect all `/v2/*` endpoints with basic auth (constant-time comparison) and
  answer `400` when `X-Broker-API-Version` is missing and `412` when it is older than 2.13
  ([ADR-0004](adr/0004-version-header-and-app-blockers.md)), and echo
  `X-Broker-API-Request-Identity`.
- **OSB0-F-04** MUST offer `/healthz` (process) and `/readyz` (CAPI Navigator reachable with the
  token) without auth.
- **OSB0-F-05** MUST log every request with method, path, instance and binding ID, the
  originating identity's `user_id` and the result; never credentials.
- **OSB0-F-06** MUST run lint, typecheck and tests in CI; tests run against a fake of the CAPI
  Navigator API.

### OSB-1: Catalog

- **OSB1-F-01** MUST answer `GET /v2/catalog` with one offering (`bindable: true`,
  `plan_updateable: false`, `instances_retrievable: false`, `bindings_retrievable: false`, tags
  `kubernetes`, `cluster-api`) and one plan per blueprint of the configured connection.
- **OSB1-F-02** MUST map a blueprint to a plan: `name` = blueprint name, `description` = display
  name, `metadata.displayName` and `metadata.bullets` from description, provider, distribution and
  version, `free: true` unless configured, and `schemas.service_instance.create.parameters` = the
  blueprint's `parametersSchema` unchanged.
- **OSB1-F-03** MUST set `maximum_polling_duration` (default 3600 s, configurable).
- **OSB1-F-04** SHOULD offer only blueprints matching a configured name list or prefix.
- **OSB1-F-05** MUST cache the catalog for a short time (default 60 s) so CF polling does not load
  the app.

### OSB-2: Provision, deprovision, last operation

- **OSB2-F-01** MUST answer `422 AsyncRequired` when `accepts_incomplete=true` is missing on
  provision or deprovision.
- **OSB2-F-02** MUST provision by looking up the instance label first: none → create the cluster
  from the plan's blueprint with the requested parameters and the labels of section 3, answer
  `202` with `operation: "provision"`; found with the same `params-hash` → `202` (still in
  progress) or `200` (ready); found with another hash → `409`.
- **OSB2-F-03** MUST map errors of the app to OSB answers that leave nothing behind (4xx rule of
  the spec): `400` (parameters) → `400` with the app's message as `description`; `409` with
  blockers (e.g. provider not ready) → `400` with the app's message and hint as `description`
  ([ADR-0004](adr/0004-version-header-and-app-blockers.md)); unknown plan → `400`; app
  unreachable or `5xx` → `500` (CF then runs orphan mitigation, which the deprovision of
  OSB2-F-06 handles).
- **OSB2-F-04** MUST pass the context fields only as labels; the organization and space names are
  not stored (they may change).
- **OSB2-F-05** MUST answer `last_operation` from the cluster summary found by label:
  - provision: `ready` → `succeeded`; phase `Failed` → `failed` with the app's message;
    otherwise `in progress` with a short description (phase, machines ready).
  - deprovision: cluster still listed → `in progress` (`deletion.phase` as description), phase
    `cleanup-timeout` → `failed` with a hint; cluster gone → `410 Gone`.
  - No cluster with the instance label during provision → `failed` (it was never created or
    was removed outside the broker).
- **OSB2-F-06** MUST deprovision by deleting the cluster with cleanup (`confirmName` = cluster
  name) and answer `202` with `operation: "deprovision"`; an instance that does not exist → `410`;
  a deletion already running → `202` again.
- **OSB2-F-07** MUST set `Retry-After` on `last_operation` (default 30 s).
- **OSB2-F-08** MUST refuse `PATCH /v2/service_instances/:id` with `422` and a description that
  updates are not supported.

### OSB-3: Bind and unbind

- **OSB3-F-01** MUST bind synchronously: the instance must be ready (otherwise `422
ConcurrencyError`), then answer `201` with `credentials`:
  `{ "kubeconfig": "<text>", "server": "<API server URL from the kubeconfig>", "cluster": "<name>",
"namespace": "<namespace in CAPI Navigator>" }`.
- **OSB3-F-02** MUST accept repeated binds of the same ID (stateless: `201` again with fresh
  credentials) and document that.
- **OSB3-F-03** MUST unbind with `200 {}` without any call to the app (nothing to revoke);
  document that the kubeconfig stays valid until the instance is deleted and that every developer
  of the space can read it.
- **OSB3-F-04** MUST never log or cache the kubeconfig.

### OSB-4: Packaging, documentation, live acceptance

- **OSB4-F-01** MUST ship a container image (non-root, read-only root file system) and a way to
  run it: a Helm chart for Kubernetes and a Compose file for Docker and Podman
  ([ADR-0002](adr/0002-container-image-with-helm-and-compose.md)).
- **OSB4-F-02** MUST document: setup of the technical user and role in CAPI Navigator, broker
  configuration, `cf create-service-broker`, `cf enable-service-access`, an example order with
  parameters, and the limits of section 1.
- **OSB4-F-03** MUST pass a live acceptance with a real Cloud Foundry (or Korifi) and CAPI
  Navigator: catalog, create with parameters, bind and use the kubeconfig, delete; refused
  parameters; a second `create-service` with the same name.

## 5. Acceptance criteria

- [ ] `cf marketplace` shows one plan per blueprint with the parameters from the blueprint.
- [ ] `cf create-service … -c '{"workerPools":{"default":{"replicas":2}}}'` creates a cluster in
      CAPI Navigator with the labels of section 3; `cf service` shows "create in progress" and
      later "create succeeded".
- [ ] Parameters outside the limits are refused with a readable message; nothing is created.
- [ ] `cf bind-service` (or `cf create-service-key`) returns a kubeconfig that works with
      `kubectl get nodes`.
- [ ] `cf delete-service` deletes the cluster with cleanup; the instance disappears after the
      cluster is gone.
- [ ] Repeating provision, deprovision and bind requests gives the answers the spec demands.
- [ ] No token, password or kubeconfig appears in the broker's logs.

## 6. Non-functional requirements

- **NF-01** Stateless; several replicas possible.
- **NF-02** At most one CAPI Navigator call per OSB request plus the cached catalog; no polling of
  its own.
- **NF-03** Test coverage of the request handling ≥ 80 % lines.
- **NF-04** Pinned dependency versions; image built in CI on tags.
- **NF-05** License Apache-2.0 (like `capi-navigator-images`), unless decided otherwise.

## 7. Known limits to document

- One instance is one cluster: clusters take minutes to create; CF users see "in progress".
- The kubeconfig is the cluster's admin kubeconfig. Cluster API rotates the client certificate of
  kubeadm clusters; an old binding may stop working, a new binding gets the current one.
- Capacity: CAPI Navigator is designed for about 50 clusters per management cluster; the broker
  enforces no limit.
- Clusters can be upgraded only by CAPI Navigator admins (blueprint clusters stay bound).

## 8. Testing

- Unit and contract tests against a fake CAPI Navigator API (recorded from its OpenAPI schemas):
  every endpoint, every status code of section 4.
- Optional opt-in test against a real CAPI Navigator with a blueprint on kind-backed providers or
  Proxmox VE, with the user's approval.
- Live acceptance with Cloud Foundry in OSB-4.

## 9. Open decisions for the first session

Ask one at a time, with a recommendation:

1. ~~Language and stack: TypeScript/Node.js (same as CAPI Navigator, typed client from its OpenAPI)
   or Go (common in the CF world, existing OSB libraries such as `brokerapi`).~~ Decided:
   TypeScript with Fastify on Node.js 26 ([ADR-0001](adr/0001-typescript-fastify-node-26.md)).
2. ~~How it runs: container with Helm chart, CF app (`cf push`) or both.~~ Decided: container
   image for Docker, Podman (Compose) and Kubernetes (Helm chart), no CF app
   ([ADR-0002](adr/0002-container-image-with-helm-and-compose.md)).
3. ~~Repository name and license.~~ Decided: `capi-navigator-osb`, Apache-2.0 (NF-05).
4. ~~Offering name and ID, label prefix.~~ Decided: `kubernetes-cluster`, a fixed default ID,
   prefix `osb.capi-navigator.io` ([ADR-0003](adr/0003-offering-and-label-prefix-defaults.md)).
5. ~~The exact answer to missing or old `X-Broker-API-Version` (`400` vs `412`) and the mapping of
   app blockers (OSB2-F-03).~~ Decided: missing `400`, too old `412`; blockers `400`
   ([ADR-0004](adr/0004-version-header-and-app-blockers.md)).
