# ADR-0006: OpenAPI document and Swagger UI of the broker

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-0 (new requirement OSB0-F-07)

## Context

The user asked for a Swagger interface, so operators and developers can read and try the broker's
endpoints without a Cloud Foundry. The requirements did not include one; hard rule 5 asks for an
ADR before features beyond them and before extra frameworks.

## Decision

- The broker describes its own endpoints (`/v2/*`, `/healthz`, `/readyz`) as an **OpenAPI 3.1
  document**, generated from the route schemas with `@fastify/swagger`, and serves **Swagger UI**
  with `@fastify/swagger-ui` (both official Fastify plugins, assets bundled, no CDN).
- Paths: the UI at `/docs`, the document at `/docs/openapi.json`. Both need no authentication: they
  contain no secrets and no data of instances.
- The document declares basic auth for `/v2/*` and the `X-Broker-API-Version` header (default
  `2.17`), so "Try it out" works with the broker credentials.
- `SWAGGER_UI_ENABLED` (default `true`) switches the UI and the document off, for operators who
  do not want them reachable.
- Route schemas are the single source: the same schemas validate requests and feed the document,
  as far as the OSB error format allows (OSB errors are answered by our own handlers, not by
  Fastify's default validation errors).

## Consequences

- Two more dependencies, both from the Fastify organisation.
- The document describes the broker as implemented, not the full OSB specification; it is no
  replacement for the spec.
- Requests sent from the UI are real requests: with a broker against a real CAPI Navigator,
  "Try it out" on provision creates real clusters. The documentation says so.
