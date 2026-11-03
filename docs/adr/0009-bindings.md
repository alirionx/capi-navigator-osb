# ADR-0009: Details of bind and unbind

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-3 (OSB3-F-01 to OSB3-F-04)

## Context

OSB-3 binds synchronously and hands out the admin kubeconfig of the instance's cluster. The broker
keeps no state (hard rule 1), so it cannot tell a new binding from a repeated one, nor an unknown
binding from a deleted one. A few answers are not fixed by the requirements.

## Decision

- **Unknown instance** (no cluster with the instance label) → `400`. The spec defines no code for
  it; Cloud Foundry only binds instances it knows, so this happens only after a cluster was
  removed outside the broker.
- **Cluster not ready, being deleted, or kubeconfig not available yet** → `422` with
  `ConcurrencyError` and a description that says to bind again later.
- **Binding parameters:** the plans offer none; a binding with non-empty `parameters` → `400`.
- **IDs:** instance and binding IDs must be UUIDs, like in ADR-0008.
- **`server`** in the credentials is read from the first `server:` line of the kubeconfig with a
  regular expression, not with a YAML library (hard rule 5); it is left out if there is none.
- **Unbind** always answers `200 {}` without a call to CAPI Navigator, also for a binding it never
  saw: it cannot know (no `410`).

## Consequences

- Every bind reads the kubeconfig again (audited in CAPI Navigator under the broker's user).
- The documentation (OSB4-F-02) says: the kubeconfig is the admin kubeconfig, stays valid until
  the instance is deleted, and every developer of the space can read it.
