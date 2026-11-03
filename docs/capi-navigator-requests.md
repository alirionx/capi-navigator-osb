# Requests for the CAPI Navigator backlog

Things the broker needs or would like from CAPI Navigator. The broker does not change CAPI
Navigator itself (hard rule 6 in `CLAUDE.md`); the user carries these over to its backlog.
CNR-01 to CNR-03 and CNR-05 were done in CAPI Navigator on 2026-11-04 (commits up to `05240f3`);
CNR-04 was declined: the broker uses the status endpoint.

## CNR-01: Document `labelSelector` in the OpenAPI document (done)

`GET /api/connections/{connection}/clusters` accepts `labelSelector` (FP34-F-10), but
`docs/api/openapi.json` mentions it only in the description, not as a query parameter. Generated
clients miss it; the broker adds it by hand
([ADR-0005](adr/0005-corrections-from-the-handover-review.md)).

## CNR-02: Fix the technical user in `docs/blueprints.md` (done)

"Technical user for a client" says all four permissions are limited to the blueprint's connection
and namespace. `view` needs an unlimited role assignment; only `clusters.create`,
`clusters.delete` and `clusters.kubeconfig` can be limited
([ADR-0005](adr/0005-corrections-from-the-handover-review.md)).

## CNR-03: Keep subdomains of `capi-navigator.io` allowed for user labels (done)

The broker's default label prefix is `osb.capi-navigator.io`
([ADR-0003](adr/0003-offering-and-label-prefix-defaults.md)). Today only keys starting with
`capi-navigator.io/` are reserved; if the reserved prefixes are ever widened to subdomains, this
prefix needs an exception.

## CNR-04: A message for failed clusters in `ClusterSummary` (declined)

`ClusterSummary` has no message, so `last_operation` reads the cluster status once more for a
failed cluster ([ADR-0005](adr/0005-corrections-from-the-handover-review.md)). A `message` in the
summary would save that call.

## CNR-05: Do not block `POST …/delete` while the cleanup starts (done)

`ClusterDeletionService.delete` (`apps/backend/src/clusters/cluster-deletion.service.ts`) first
tries to start the cleanup in the workload cluster and retries for up to `DELETION_TIMING.startMs`
(60 s) when its API is not reachable; only then does it set the deletion annotation and answer.
The Cloud Controller of Cloud Foundry waits 60 s for a broker by default, so a deprovision can time
out although the deletion goes on. Request: record the deletion (annotation with phase `cleanup`)
first and start the cleanup in the background, so the endpoint answers at once and the progress
shows in `deletion`. Done in CAPI Navigator commit `05240f3`; the broker's workaround is removed
([ADR-0008](adr/0008-service-instances.md)).
