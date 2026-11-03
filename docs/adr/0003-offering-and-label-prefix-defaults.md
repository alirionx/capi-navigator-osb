# ADR-0003: Defaults for the service offering and the label prefix

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-0 (open decision 4, OSB0-F-01)

## Context

The operator configures the offering name, ID and description and the label prefix (OSB0-F-01).
The broker needs defaults for them. Two of these values can never change once instances exist:

- The **offering ID**: plan IDs are UUID v5 of the offering ID and the blueprint name (section 3);
  a new offering ID gives new plan IDs, and Cloud Foundry no longer recognises existing instances.
- The **label prefix**: the broker finds the cluster of an instance only by its labels (hard
  rule 1); a new prefix leaves existing clusters unfound.

The handover proposed `osb-broker/` as prefix, written with a trailing slash, while section 3
writes the keys as `<prefix>/instance-id`, which would give a double slash. CAPI Navigator refuses
label keys that start with `capi-navigator.io/` or `cluster.x-k8s.io/`
(`RESERVED_LABEL_PREFIXES` in `packages/shared/src/cluster/spec.ts`); subdomains of them are
allowed.

## Decision

| Setting              | Default                                                 |
| -------------------- | ------------------------------------------------------- |
| Offering name        | `kubernetes-cluster`                                    |
| Offering ID          | `0b0c9e40-7db5-45ae-a810-f4459a2fad3b`                  |
| Offering description | `Kubernetes clusters from CAPI Navigator blueprints`    |
| Label prefix         | `osb.capi-navigator.io` (without the trailing slash)    |

Label keys are `<prefix>/<key>`, e.g. `osb.capi-navigator.io/instance-id`. The configured prefix
must be a DNS subdomain and must not be or start with one of the reserved prefixes; the broker
refuses to start otherwise.

## Consequences

- The documentation (OSB4-F-02) warns that the offering ID and the label prefix must not change
  after the first instance.
- If CAPI Navigator ever reserves subdomains of `capi-navigator.io`, it needs an exception for
  this prefix; this is noted for the CAPI Navigator backlog.
- Several brokers against the same CAPI Navigator need different offering IDs and prefixes.
