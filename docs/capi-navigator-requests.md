# Requests for the CAPI Navigator backlog

Things the broker needs or would like from CAPI Navigator. The broker does not change CAPI
Navigator itself (hard rule 6 in `CLAUDE.md`); the user carries these over to its backlog.
CNR-01 to CNR-03 and CNR-05 were done in CAPI Navigator on 2026-11-04 (commits up to `05240f3`);
CNR-04 was declined: the broker uses the status endpoint. CNR-06 is open.

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

## CNR-06: A node network pool for OpenStack blueprints (open)

**Problem.** All clusters of an OpenStack blueprint get the node network of its base spec
(`docs/blueprints.md`). Some clouds refuse that. On a corporate OpenStack with a routed VRF per
project (Neutron error `SubnetOverlapInRoutedVRF`, seen 2026-11-09), every routed subnet of a
project shares one VRF. CAPO creates the second cluster's network and subnet, then fails to attach
the subnet to the cluster's router:

```text
failed to reconcile router: unable to create router interface: … 400 …
{"NeutronError": {"type": "SubnetOverlapInRoutedVRF", "message": "Subnets … (10.7.1.0/24) and
… (10.7.1.0/24) mapped to VRF(prj_…,DefaultVRF) overlap."}}
```

The order is accepted, but the cluster never becomes ready. Through the broker, the Cloud Foundry
user sees "create in progress" until `MAX_POLLING_DURATION_SECONDS` (default one hour), then
"create failed". So a blueprint on such a cloud serves only one cluster at a time. This is not a
misconfiguration that is likely to change: the VRF per project belongs to the cloud's network
design. One blueprint per cluster is no option for a service offering.

**Request.** Extend FP34-F-14 to OpenStack: an OpenStack blueprint can carry a **node network
pool** instead of a fixed node network, e.g. `10.7.0.0/16` split into `/24` networks. For every
order the app picks the first free network of the pool and puts it into the spec of the new
cluster. Proposed requirement text:

> **FP34-F-15** MUST give every cluster of an OpenStack blueprint with a node network pool a node
> network of its own: the first network of the pool's size (default `/24`) that overlaps neither a
> subnet of the project (lookup `subnets`, FP5-F-21) nor the node network of another cluster of the
> management cluster with the same credentials, read from the cluster specs. Orders of a connection
> run one after another (as for FP34-F-14), and both sources are read inside that order, so two
> orders never get the same network even before CAPO has created the first subnet. An exhausted
> pool refuses the order with `409` and a message that names the pool. The pool is offered through
> the infrastructure provider plugin (hard rule 10): one pool interface that a plugin may
> implement, used by Proxmox VE for addresses (FP34-F-14) and by OpenStack for node networks;
> providers without it are unchanged. Blueprints with a fixed node network keep working as today.

**Points to decide in CAPI Navigator** (from the review with the CAPI Navigator session):

- **Hosted control planes:** FP34-F-14 excludes them on Proxmox VE. On OpenStack a tenant
  cluster has its own node network too; the pool can probably apply there as well.
- **Freeing a network:** a deleted cluster frees its network only when CAPO has removed the subnet.
  Shortly after a deletion a nearly used-up pool may answer `409`. Uncritical, but documented in
  `docs/blueprints.md`.
- **Pool size check when saving:** the pool should hold at least one network and must not overlap
  the external network or, if known, the pod and service CIDRs of the base spec.

**Acceptance criteria (proposed)**

- [ ] Two clusters from one OpenStack blueprint with a pool get different node networks, also when
      ordered right after each other (before the first subnet exists).
- [ ] A subnet of the project that is not from the app (created by hand) is skipped.
- [ ] An exhausted pool answers `409` with a message that names the pool; nothing is created.
- [ ] AWS, GCP and Proxmox VE blueprints and OpenStack blueprints with a fixed network are
      unchanged (tests).
- [ ] The blueprints page shows the pool and the network of each cluster.
- [ ] Live on an OpenStack that refuses overlapping subnets: two clusters of one blueprint come up
      side by side.

**For the broker:** no code change. The parameters schema of the blueprint stays the same, and an
exhausted pool reaches Cloud Foundry as the app's `409` message (`src/osb/instances.ts`). The
broker raises its API pin to the release with FP34-F-15, adds a test for that `409` and a note in
`docs/operations.md`, and repeats the live check with two instances of one OpenStack plan.
