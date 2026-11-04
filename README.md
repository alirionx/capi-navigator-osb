# CAPI Navigator Service Broker

> **Status:** in development. All OSB endpoints work (packs OSB-0 to OSB-3); packaging, operator
> documentation and the live acceptance with Cloud Foundry (OSB-4) follow.

An [Open Service Broker](https://www.openservicebrokerapi.org/) (API v2.17) that lets Cloud Foundry
users order Kubernetes clusters from [CAPI Navigator](https://github.com/alirionx/capi-navigator).

- `cf marketplace` lists one plan per **cluster blueprint** of CAPI Navigator.
- `cf create-service` creates a cluster from the blueprint, with the parameters it allows.
- `cf bind-service` / `cf create-service-key` hands out the cluster's kubeconfig.
- `cf delete-service` deletes the cluster with cleanup.

The broker is deliberately small and stateless: a thin translation layer between the OSB API and
the REST API of CAPI Navigator. It stores no state of its own.

### What a binding gives you

A binding (or service key) contains the **admin kubeconfig** of the cluster, plus `server`,
`cluster` and `namespace`. Keep in mind:

- Every developer of the space can read it (`cf service-key`, the app's environment).
- Unbinding revokes nothing: the kubeconfig stays valid until the service instance is deleted.
  To rotate it, delete the instance.
- A repeated bind returns the current kubeconfig; Cluster API rotates the client certificate of
  kubeadm clusters, so an old binding may stop working while a new one works.

**Operators:** see [docs/operations.md](docs/operations.md) for setup, configuration, Helm,
Compose and registration in Cloud Foundry.

See [docs/requirements.md](docs/requirements.md) for the requirements and the plan, and
[docs/adr/](docs/adr/) for the decisions.

## Development

Requirements: Node.js 26 and pnpm in the version of `packageManager` in `package.json`
(`npm install --global "$(node -p 'require("./package.json").packageManager')"`; Node.js 26 has no
corepack).

```sh
pnpm install
cp .env.example .env   # fill in CAPI Navigator URL, token and broker credentials
pnpm dev               # broker on http://localhost:8080, Swagger UI on /docs
```

| Command                | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `pnpm test`            | Tests against a fake of the CAPI Navigator API                                   |
| `pnpm test:coverage`   | Tests with coverage (at least 80 % lines)                                        |
| `pnpm lint`            | ESLint and Prettier                                                              |
| `pnpm typecheck`       | TypeScript                                                                       |
| `pnpm build`           | Compiles to `dist/`; start with `pnpm start`                                     |
| `pnpm api:update`      | Moves the supported CAPI Navigator API to another commit or tag                  |
| `pnpm secrets:scan`    | gitleaks (Docker) over the Git history and the working tree; run before pushing  |
| `pnpm versions:report` | Looks up newer versions with Renovate (Docker), writes `docs/versions-report.md` |

Keeping versions current and scanning for secrets: [docs/maintenance.md](docs/maintenance.md).

The broker talks to CAPI Navigator only through its REST API, with the token of a technical user.
The supported API version is pinned in [api/README.md](api/README.md).

Endpoints without authentication: `/healthz`, `/readyz` (CAPI Navigator reachable, token valid),
`/docs` (Swagger UI) and `/docs/json` (OpenAPI document). Everything under `/v2` needs the broker
credentials and the header `X-Broker-API-Version`.

## License

[Apache-2.0](LICENSE)
