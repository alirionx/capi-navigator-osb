# CLAUDE.md – CAPI Navigator Service Broker

This file tells Claude Code how to work in this repository. Read it fully before every session.

## What this project is

An Open Service Broker (OSB API v2.17) that lets Cloud Foundry users order Kubernetes clusters from
[CAPI Navigator](https://github.com/alirionx/capi-navigator). Each plan is a **cluster blueprint**
of CAPI Navigator (its FP-34); provisioning creates a cluster from the blueprint, binding hands out
its kubeconfig, deprovisioning deletes it. The broker is deliberately **simple**: a thin, stateless
translation layer between the OSB API and the REST API of CAPI Navigator.

## Source of truth

- **Requirements:** `docs/requirements.md` (packs OSB-0 to OSB-4, non-functional requirements, open
  decisions). Always follow it.
- **Decisions:** `docs/adr/`, one short ADR per decision that refines or deviates from the
  requirements.
- **CAPI Navigator API:** its OpenAPI description `docs/api/openapi.json` in the CAPI Navigator
  repository, at the release this broker supports. Never guess endpoints or fields of that API.
- **OSB API:** the specification v2.17 (`spec.md` and `profile.md` of
  `openservicebrokerapi/servicebroker`). Check status codes and fields there, not from memory.

If this file and `docs/requirements.md` disagree, the requirements win. Point out the conflict.

## How to work: one pack at a time

1. Find the current pack in the status table below. Do not start the next before the current one
   is done.
2. Read the pack's section in the requirements, make a short plan and confirm it with the user
   before writing larger amounts of code.
3. Ask the user about open decisions one at a time, with context, as a selection with a
   recommended option. The user writes German; code, docs and commits are English.
4. Implement in small commits with tests. A pack is done when its MUST criteria are met and lint,
   typecheck and tests pass.
5. Tick the criteria in the requirements, update the table below, summarize what was deferred.

| Pack  | Content                                                   | Status  |
| ----- | --------------------------------------------------------- | ------- |
| OSB-0 | Scaffold, configuration, App API client, CI               | open    |
| OSB-1 | Catalog from the blueprints                               | open    |
| OSB-2 | Provision, deprovision, last operation                    | open    |
| OSB-3 | Bind and unbind                                           | open    |
| OSB-4 | Packaging, documentation, live acceptance with CF         | open    |

## Hard rules

1. **Stateless, no database.** Everything the broker needs to remember lives on the cluster in CAPI
   Navigator: labels set at creation and the blueprint annotation. Any replica can answer any
   request.
2. **Only the CAPI Navigator REST API.** No Kubernetes API access, no cloud APIs, no shortcuts
   around the app. Permissions, audit, validation and cleanup stay in the app.
3. **Secrets stay secret.** The app token, the broker password and every kubeconfig are never
   logged, never put into error messages and never stored by the broker. Kubeconfigs only pass
   through to the binding response.
4. **Follow the OSB API exactly**: status codes, `accepts_incomplete`, `operation`, error codes
   (`AsyncRequired`, `ConcurrencyError`), idempotent PUT and DELETE.
5. **Keep it small.** No updates, no plan changes, no own UI, no extra frameworks without asking.
   Features beyond the requirements need an ADR first.
6. **No changes in CAPI Navigator from here.** If the broker needs something from the app, write it
   down as a request for the CAPI Navigator backlog and tell the user.

## Safety while working

- Do not create or delete clusters through a real CAPI Navigator or touch a real Cloud Foundry
  without asking the user first. Use the fake App API of the tests by default.
- Never commit tokens, passwords or kubeconfigs. Read tokens only from mode-600 files or
  environment variables and never print them.
- Commits are fine; never `git push` – the user pushes.

## Conventions

- Requirement IDs (`OSB2-F-03`) go into commit messages, test names and comments.
- Conventional commits, e.g. `feat(osb2): poll the cluster status in last_operation (OSB2-F-05)`.
- Errors of the App API are mapped to OSB responses with a `description` a CF user understands.
