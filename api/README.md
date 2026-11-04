# CAPI Navigator API

`capi-navigator.openapi.json` is the OpenAPI document of CAPI Navigator (`docs/api/openapi.json`
in its repository) at the commit the broker supports. The client types in
`src/capi/schema.generated.ts` are generated from it (OSB0-F-02).

- Commit: `dbe093dd16d3eb40efdf8f165b07c8b0feda77b3` (v0.17.0)
- Works with CAPI Navigator 0.16.0 or later (cluster blueprints, FP-34); accepted live against
  0.17.0 ([ADR-0005](../docs/adr/0005-corrections-from-the-handover-review.md)).

Update with `pnpm api:update <commit or tag> [path to a CAPI Navigator clone]`; the default clone
is `../capi-navigator`. CI checks that the generated types match the document.
