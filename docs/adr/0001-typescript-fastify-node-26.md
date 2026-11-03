# ADR-0001: TypeScript with Fastify on Node.js 26

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-0 (open decision 1)

## Context

The requirements leave the stack open: TypeScript/Node.js like CAPI Navigator, or Go with an
existing OSB library such as `brokerapi`.

- The OpenAPI description of CAPI Navigator is OpenAPI 3.1. `openapi-typescript` supports 3.1
  fully; Go generators such as `oapi-codegen` support it only in part.
- The OSB surface the broker needs is small (catalog, provision, deprovision, last operation,
  bind, unbind, plus basic auth and the version header), and its status codes and errors must
  follow the spec exactly (hard rule 4). Writing it by hand keeps that in our control.
- CAPI Navigator is TypeScript (pnpm, Zod, vitest, eslint, prettier, Renovate); the same tooling
  keeps both projects maintainable by the same people.

## Decision

- TypeScript (strict, ESM) on **Node.js 26** (Active LTS since October 2026), pnpm.
- **Fastify** as HTTP server; tests use `fastify.inject()` without a real port.
- **Zod** for the configuration from environment variables (OSB0-F-01).
- **`openapi-typescript` + `openapi-fetch`** for the typed client of the CAPI Navigator API
  (OSB0-F-02).
- **vitest** for tests and coverage, eslint and prettier for lint.
- The OSB API layer is our own code; no OSB framework.

## Consequences

- No ready-made OSB library: the OSB contract is covered by our own tests against the spec.
- The container image needs a Node.js 26 base image (checked in OSB-4).
- Go and `brokerapi` are not used.
