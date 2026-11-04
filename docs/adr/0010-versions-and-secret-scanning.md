# ADR-0010: Version pins and secret scanning without bots

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-4 (NF-04, hard rule 3)

## Context

The broker pins few versions: Node.js, pnpm, five GitHub Actions, the base image and the tools its
scripts run in Docker; npm packages are pinned exactly in `package.json` and `pnpm-lock.yaml`. pnpm
stood in four places. Nothing told the maintainer that newer versions exist.

The broker also holds a CAPI Navigator token that can create and delete clusters, and hands out
admin kubeconfigs. GitHub's secret scanning does not know `capin_` tokens.

CAPI Navigator settled the same questions in its ADR-0018: update bots only help when someone
reviews their pull requests regularly, and the Mend-hosted Renovate app needs a personal sign-up,
which conflicts with the "as code" principle. Both projects are maintained by the same person.

## Decision

Do it the way CAPI Navigator does, scaled to this repository:

- **Versions in their standard files**, each in one place: Node.js in `.nvmrc` and the `FROM` lines
  of the `Dockerfile`; pnpm only in `packageManager` of `package.json` (the `Dockerfile` and the
  workflows read it from there); Actions in the workflows; tool images in the scripts, marked with
  a `# renovate:` comment. No `versions.yaml`: too few pins to justify a generator.
- **Couplings as tests** (`test/versions.test.ts`): the Node.js major of the `Dockerfile` equals
  `.nvmrc`; no other file pins pnpm.
- **Renovate as a lookup tool, not as a bot.** `pnpm versions:report` runs Renovate in a pinned
  container with `--platform=local` on a read-only mount and writes `docs/versions-report.md`.
  `renovate.json` only configures these lookups. The local `gh` login is passed for this run only.
  npm packages stay out of the report (`pnpm outdated`). No schedule, no pull requests, no stored
  token, no hosted app.
- **Secret scanning with gitleaks**, `pnpm secrets:scan`: gitleaks in a pinned container over the
  Git history and the working tree, findings redacted. `.gitleaks.toml` uses the default rules plus
  a rule for CAPI Navigator API tokens (`capin_` and 43 base64url characters); test fixtures are
  allow-listed by value, not by file. It runs by hand before pushing, as in CAPI Navigator; not in
  CI for now (the user's decision).
- Updating is a deliberate, manual step described in `docs/maintenance.md`.

## Consequences

- One place per version; the report shows how current the broker is, but only as of its last run.
- A leaked token is found before it is pushed only if the scan is run; GitHub push protection stays
  the second line for the secrets it knows.
- Not done (CAPI Navigator does not either): `pnpm audit` and image scanning in CI, digest pins of
  Actions and base image, Dependabot. Each can be added later without changing this decision.
