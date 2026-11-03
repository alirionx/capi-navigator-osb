# CAPI Navigator API

`capi-navigator.openapi.json` is the OpenAPI document of CAPI Navigator (`docs/api/openapi.json`
in its repository) at the commit the broker supports. The client types in
`src/capi/schema.generated.ts` are generated from it (OSB0-F-02).

- Commit: `05240f34e5fbc08ee249d330d0f74cc8fc299792` (main after v0.15.1: FP-34, CNR-01 to CNR-05)
- Expected release: 0.16.0; move the pin to its tag once it exists
  ([ADR-0005](../docs/adr/0005-corrections-from-the-handover-review.md)).

Update with `pnpm api:update <commit or tag> [path to a CAPI Navigator clone]`; the default clone
is `../capi-navigator`. CI checks that the generated types match the document.
