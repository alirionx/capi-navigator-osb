#!/usr/bin/env bash
# Secret scan with gitleaks in Docker (`pnpm secrets:scan`), e.g. before pushing (ADR-0010).
#
# Scans the whole Git history and, separately, the working tree (uncommitted and untracked files
# not ignored by Git). Findings are printed redacted, so a real secret does not end up in the
# terminal log as well. Rules and the allowlist for test fixtures: .gitleaks.toml.
# Exit code 0: nothing found; 1: findings (see the report above).
#
#   GITLEAKS_IMAGE=…   other image than the pinned one
#   SCAN=history|dir   only one of the two scans
set -euo pipefail

# renovate: datasource=docker depName=ghcr.io/gitleaks/gitleaks
GITLEAKS_VERSION="v8.30.1"
IMAGE="${GITLEAKS_IMAGE:-ghcr.io/gitleaks/gitleaks:${GITLEAKS_VERSION}}"
SCAN="${SCAN:-all}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

run() {
  local mount="$1"
  shift
  # Read-only mount; the container runs as the current user, so Git trusts the repository.
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "${mount}:/repo:ro" -v "${ROOT_DIR}/.gitleaks.toml:/config/.gitleaks.toml:ro" -w /repo \
    -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
    "${IMAGE}" "$@" --config /config/.gitleaks.toml --redact --no-banner --verbose
}

status=0
if [[ "${SCAN}" == all || "${SCAN}" == history ]]; then
  echo "==> Git history ($(git rev-list --all --count) commits) with ${IMAGE}"
  run "${ROOT_DIR}" git /repo || status=1
fi
if [[ "${SCAN}" == all || "${SCAN}" == dir ]]; then
  # Only files Git would track (committed, changed, untracked but not ignored), copied into a
  # temporary directory: node_modules, build output, .env, secrets/ and *.local.md stay out.
  echo "==> Working tree (tracked, changed and untracked files)"
  tree="$(mktemp -d)"
  trap 'rm -rf "${tree}"' EXIT
  git ls-files --cached --others --exclude-standard -z |
    while IFS= read -r -d '' file; do
      [[ -f "${file}" ]] && printf '%s\0' "${file}"
    done | xargs -0 -r cp --parents -t "${tree}"
  run "${tree}" dir /repo || status=1
fi

if [[ "${status}" -eq 0 ]]; then
  echo "==> No secrets found."
else
  echo "==> Possible secrets found (values redacted above). Remove them, rotate them if they were real," >&2
  echo "    or allow-list test fixtures in .gitleaks.toml." >&2
fi
exit "${status}"
