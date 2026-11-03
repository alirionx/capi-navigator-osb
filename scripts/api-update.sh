#!/usr/bin/env bash
# Copies the OpenAPI document of CAPI Navigator at a commit or tag into api/ and regenerates the
# client types (OSB0-F-02, ADR-0005). Usage: pnpm api:update <ref> [path to a CAPI Navigator clone]
set -euo pipefail

ref="${1:?usage: pnpm api:update <commit or tag> [path to a CAPI Navigator clone]}"
repo="${2:-${CAPI_NAVIGATOR_REPO:-../capi-navigator}}"
root="$(cd "$(dirname "$0")/.." && pwd)"

commit="$(git -C "$repo" rev-parse --verify "$ref^{commit}")"
git -C "$repo" show "$commit:docs/api/openapi.json" > "$root/api/capi-navigator.openapi.json"
sed -i "s/^- Commit: .*/- Commit: \`$commit\` ($ref)/" "$root/api/README.md"
(cd "$root" && pnpm api:types)
echo "api/capi-navigator.openapi.json is now at $commit"
