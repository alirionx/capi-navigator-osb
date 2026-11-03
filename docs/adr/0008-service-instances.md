# ADR-0008: Service instances: IDs, parameters hash and slow deletions

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-2 (OSB2-F-02, OSB2-F-05, OSB2-F-06)

## Context

Section 3 derives the cluster name from the instance ID (`cf-` plus the ID without hyphens) and
stores the ID as a label value. The OSB API allows any string as instance ID; Kubernetes names
and label values do not.

CAPI Navigator's `POST …/delete` with cleanup first starts the cleanup in the workload cluster and
retries for up to 60 s when its API is not reachable, and only then records the deletion and
answers. The Cloud Controller waits 60 s for a broker by default.

## Decision

- **Instance IDs must be UUIDs** (Cloud Foundry always sends GUIDs); other IDs are refused with
  `400`. The cluster name is `cf-` plus the 32 hex digits in lower case.
- **Parameters hash:** the first 32 hex digits of SHA-256 over `<plan ID>\n<canonical JSON>`, where
  the canonical JSON of the parameters (`{}` if none) sorts object keys recursively. The same
  order with other key order or whitespace gives the same hash.
- **Repeated provision** of an instance whose cluster is being deleted → `409`.
- **Slow deletions:** the broker waits at most 45 s for `POST …/delete`. If the app has not
  answered by then, the broker answers `202` with `operation: "deprovision"` anyway: the app goes
  on with the deletion. `last_operation` reports a cluster without `deletion` during a
  deprovision as "in progress" ("deletion starting"). Should the app fail after the broker gave
  up, the operation ends with `maximum_polling_duration` and the user can delete again. Request
  CNR-05 asks CAPI Navigator to answer at once; the workaround goes away then.

## Consequences

- Cloud Foundry gets an answer within its timeout even when the cleanup of a broken cluster
  cannot start.
- A failed deletion behind the timeout shows only after the maximum polling duration.
