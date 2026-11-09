# CAPI Navigator API

`capi-navigator.openapi.json` is the OpenAPI document of CAPI Navigator (`docs/api/openapi.json`
in its repository) at the commit the broker supports. The client types in
`src/capi/schema.generated.ts` are generated from it (OSB0-F-02).

- Commit: `13f35628ff18fbc56d230586dfa5292290b7920b` (v0.19.1)
- Works with CAPI Navigator 0.16.0 or later (cluster blueprints, FP-34); accepted live against
  0.17.0 ([ADR-0005](../docs/adr/0005-corrections-from-the-handover-review.md)). OpenStack blueprints
  with a node network pool (CNR-06) need 0.19.0 or later; tested live against 0.19.1.

Update with `pnpm api:update <commit or tag> [path to a CAPI Navigator clone]`; the default clone
is `../capi-navigator`. CI checks that the generated types match the document.
