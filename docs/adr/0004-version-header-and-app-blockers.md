# ADR-0004: Answers to the version header and to blockers of the app

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-0 and OSB-2 (open decision 5, OSB0-F-03, OSB2-F-03)

## Context

**Version header.** The OSB API v2.17 ("API Version Header") says a broker MAY reject a request
without `X-Broker-API-Version` with `400 Bad Request`, and MAY reject a version it does not
support with `412 Precondition Failed`, each with a message. OSB0-F-03 proposed `412` for both.

**Blockers.** CAPI Navigator answers an order it cannot run now (provider not ready, credential
not allowed, address pool exhausted) with `409` plus `message` and `hint`. The provision response
table of the spec defines `409` only for an instance that exists with other attributes, and `422`
only for `AsyncRequired` and `MaintenanceInfoConflict`. The Cloud Controller of Cloud Foundry
(`lib/services/service_brokers/v2/response_parser.rb`, `parse_provision`, read on 2026-11-04)
treats the codes as follows:

| Broker answer                    | Cloud Controller                                             |
| -------------------------------- | ------------------------------------------------------------ |
| `409`                            | `ServiceBrokerConflict` (the instance already exists)        |
| `422` with an unknown `error`    | `ServiceBrokerBadResponse` (the broker misbehaves)           |
| other `4xx` (e.g. `400`)         | `ServiceBrokerRequestRejected`, shows the `description`      |
| `5xx`                            | `ServiceBrokerBadResponse`, may start orphan mitigation      |

## Decision

- Missing `X-Broker-API-Version` → `400` with a description that names the header. Major version
  other than 2 or minor version below 13 → `412` with a description that names the supported
  versions. Both apply to all `/v2/*` endpoints and are checked after basic auth.
- A `409` of the app with blockers during provisioning → `400` with the app's `message` and, if
  present, its `hint` as `description` (e.g. `"<message> <hint>"`), without an `error` field. The
  4xx rule of the spec holds: the app has created nothing.
- The app answers an existing cluster name with `409` as well. The name comes from the instance
  ID, so this means another request (e.g. on a second replica) created the instance in the
  meantime. Because both cases share the status code, the broker looks the instance up by label
  again after every `409` of the create call: found → answer as for a repeated provision
  (OSB2-F-02); not found → blocker, `400` as above.

## Consequences

- CF users see "request rejected" with the reason from CAPI Navigator and can retry later with
  the same command.
- The live acceptance (OSB4-F-03) checks that `cf service` shows the description of a blocker.
