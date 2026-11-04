# Maintenance: versions and secrets

The broker pins every version it builds with. Updates are a deliberate, manual step: there is no
update bot ([ADR-0010](adr/0010-versions-and-secret-scanning.md), the same approach as CAPI
Navigator's ADR-0018).

## Where versions live

| What                     | Where                                              | How to change                                               |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| npm packages             | `package.json` and `pnpm-lock.yaml`                | `pnpm up --latest <package>` (never by hand)                |
| pnpm                     | `packageManager` in `package.json` – only there    | Edit; `Dockerfile` and workflows read it                    |
| Node.js                  | `.nvmrc` and the `FROM` lines of `Dockerfile`      | Edit both together (a test checks the major)                |
| GitHub Actions           | `.github/workflows/*.yaml`                         | Edit the `uses:` version                                    |
| gitleaks, Renovate       | `scripts/secret-scan.sh`, `versions-report.sh`     | Edit the variable below the `# renovate:` comment           |
| CAPI Navigator API       | `api/capi-navigator.openapi.json`                  | `pnpm api:update <ref>` ([api/README.md](../api/README.md)) |
| The broker's own version | `package.json`, `Chart.yaml` (version, appVersion) | Only for a release (`.github/workflows/release.yaml`)       |

npm caps are in [renovate.json](../renovate.json): `@typescript/typescript6` stays below 7 (it is
the TypeScript 6 API for typescript-eslint; `tsc` is TypeScript 7 from `@typescript/native`).

## 1. Find newer versions

```sh
pnpm versions:report   # needs Docker; uses your gh login for GitHub lookups if present
pnpm outdated          # npm packages
```

`pnpm versions:report` writes [versions-report.md](versions-report.md). It only looks up versions;
nothing else changes. Updates younger than three days are marked: wait for their first bug fixes
(pnpm itself also refuses packages younger than its minimum release age).

Run it before every release; commit the report.

## 2. Change and verify

- **npm**: `pnpm up --latest <package>`, or `pnpm up` for all non-major updates. Majors of Fastify,
  Zod, openapi-fetch or vitest: read the migration guide first.
- **Node.js major**: `.nvmrc`, both `FROM` lines, `engines` in `package.json` and `@types/node`.
- **CAPI Navigator API**: `pnpm api:update <ref>` regenerates the client types; the type check shows
  what changed.

```sh
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build
docker build -t capi-navigator-osb:dev .
```

For an update of Fastify, the Swagger plugins or the Node.js major, also start the broker
(`pnpm dev`) and open `/docs`.

## 3. Secrets

```sh
pnpm secrets:scan      # gitleaks in Docker over the Git history and the working tree
```

Run it before every push. Findings are printed redacted. A finding that is a real secret: remove it
from the history before pushing and rotate it (a CAPI Navigator token: revoke it in the user
management of CAPI Navigator). A deliberate fake value in a test: allow-list the value in
[.gitleaks.toml](../.gitleaks.toml).

## Checklist before a release

- [ ] `pnpm versions:report` run, updates chosen (minimum release age respected), report committed
- [ ] lint, typecheck, tests with coverage, build and image build green
- [ ] `pnpm secrets:scan` clean
- [ ] Release notes written (`docs/release-notes/X.Y.Z.md`)
