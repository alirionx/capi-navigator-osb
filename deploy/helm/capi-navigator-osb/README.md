# capi-navigator-osb Helm chart

Runs the [CAPI Navigator service broker](https://github.com/alirionx/capi-navigator-osb) on
Kubernetes: an Open Service Broker (API v2.17) that offers the cluster blueprints of
[CAPI Navigator](https://github.com/alirionx/capi-navigator) to Cloud Foundry. Each blueprint is a
plan; `cf create-service` creates a cluster from it, `cf bind-service` hands out its kubeconfig.

The chart is small on purpose: one Deployment, one Service, optionally an Ingress, and a Secret
for the two credentials. The broker is stateless and needs no storage, no database and no access
to the Kubernetes API of the cluster it runs in.

## Prerequisites

- Kubernetes 1.25 or later, Helm 3.8 or later (OCI charts).
- CAPI Navigator with cluster blueprints, reachable from the cluster.
- A technical user in CAPI Navigator with the permissions `view`, `clusters.create`,
  `clusters.delete` and `clusters.kubeconfig`, and its API token (`capin_…`). See
  [docs/operations.md](https://github.com/alirionx/capi-navigator-osb/blob/main/docs/operations.md),
  section 1.
- A password for the broker, which Cloud Foundry uses for basic auth.

## Install

Create the Secret with the token and the broker password yourself, so they do not end up in
your Helm values or shell history:

```sh
kubectl create namespace capi-navigator-osb
kubectl -n capi-navigator-osb create secret generic osb-secrets \
  --from-file=capin-token=./capin-token \
  --from-file=broker-password=./broker-password

helm install osb oci://ghcr.io/alirionx/charts/capi-navigator-osb --version 0.1.0 \
  --namespace capi-navigator-osb \
  --set config.CAPIN_URL=https://capi-navigator.example.com \
  --set config.CAPIN_CONNECTION=home \
  --set secrets.existingSecret=osb-secrets
```

Check that the broker reaches CAPI Navigator with its token:

```sh
kubectl -n capi-navigator-osb get pods          # READY 1/1 once /readyz succeeds
kubectl -n capi-navigator-osb logs deploy/osb-capi-navigator-osb
```

If the pod does not become ready, `/readyz` fails: CAPI Navigator is not reachable or refuses
the token. The log says which.

## Expose the broker to Cloud Foundry

The broker listens on plain HTTP (port 8080). Cloud Foundry should reach it over HTTPS, so let an
Ingress (or another TLS-terminating proxy) handle TLS:

```sh
helm upgrade osb oci://ghcr.io/alirionx/charts/capi-navigator-osb --version 0.1.0 \
  --namespace capi-navigator-osb --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=broker.example.com \
  --set ingress.tlsSecret=broker-tls
```

If Cloud Foundry runs in the same Kubernetes cluster, it can use the Service directly:
`http://osb-capi-navigator-osb.capi-navigator-osb.svc:8080`.

Then register the broker as Cloud Foundry admin:

```sh
cf create-service-broker capi-navigator broker "$(cat ./broker-password)" https://broker.example.com
cf enable-service-access kubernetes-cluster
cf marketplace -e kubernetes-cluster
```

## Values

| Value                                     | Default                                 | Description                                                              |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `image.repository`                        | `ghcr.io/alirionx/capi-navigator-osb`   | Image of the broker                                                      |
| `image.tag`                               | `appVersion` of the chart               | Image tag                                                                |
| `image.pullPolicy`                        | `IfNotPresent`                          |                                                                          |
| `replicaCount`                            | `1`                                     | The broker is stateless; more replicas are fine                          |
| `config.CAPIN_URL`                        | – (required)                            | URL of CAPI Navigator                                                    |
| `config.CAPIN_CONNECTION`                 | – (required)                            | Connection whose blueprints are offered                                  |
| `config.BROKER_USERNAME`                  | `broker`                                | Basic auth user for Cloud Foundry                                        |
| `config.*`                                |                                         | Any other setting of the broker as environment variable, see below       |
| `secrets.existingSecret`                  | `''`                                    | Secret with the keys `capin-token` and `broker-password` (recommended)   |
| `secrets.capinToken`                      | `''`                                    | Token, if the chart shall create the Secret                              |
| `secrets.brokerPassword`                  | `''`                                    | Broker password, if the chart shall create the Secret                    |
| `service.type` / `service.port`           | `ClusterIP` / `8080`                    |                                                                          |
| `ingress.enabled`                         | `false`                                 | Create an Ingress                                                        |
| `ingress.className`                       | `''`                                    | Ingress class                                                            |
| `ingress.annotations`                     | `{}`                                    | E.g. for cert-manager                                                    |
| `ingress.host`                            | `broker.example.com`                    | Host name                                                                |
| `ingress.tlsSecret`                       | `''`                                    | Secret with the TLS certificate; without it the Ingress serves HTTP only |
| `resources`                               | requests 50m / 96Mi, limit 256Mi memory |                                                                          |
| `nodeSelector`, `tolerations`, `affinity` | empty                                   | Scheduling                                                               |

Further settings under `config`, all optional (details in
[docs/operations.md](https://github.com/alirionx/capi-navigator-osb/blob/main/docs/operations.md),
section 2):

| Setting                        | Default                                | Note                                                  |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------- |
| `OFFERING_NAME`                | `kubernetes-cluster`                   | Name in `cf marketplace`                              |
| `OFFERING_ID`                  | `0b0c9e40-7db5-45ae-a810-f4459a2fad3b` | **Never change after the first service instance**     |
| `LABEL_PREFIX`                 | `osb.capi-navigator.io`                | **Never change after the first service instance**     |
| `BLUEPRINT_FILTER`             | all blueprints                         | Comma-separated names; `cf-*` matches a prefix        |
| `PLANS_FREE`                   | `true`                                 |                                                       |
| `MAX_POLLING_DURATION_SECONDS` | `3600`                                 | How long Cloud Foundry waits for a create or delete   |
| `CAPIN_TIMEOUT_SECONDS`        | `15`                                   | Timeout of one call to CAPI Navigator                 |
| `LOG_LEVEL`                    | `info`                                 | `debug` also logs probe requests                      |
| `SWAGGER_UI_ENABLED`           | `true`                                 | Swagger UI at `/docs`; set `'false'` to switch it off |

Values under `config` are strings; quote booleans and numbers in a values file
(`SWAGGER_UI_ENABLED: 'false'`). The token and the password never go under `config`: the chart
mounts them from the Secret as files and sets `CAPIN_TOKEN_FILE` and `BROKER_PASSWORD_FILE`.

## Security

- The pod runs as user 1000 with a read-only root file system, no capabilities, no privilege
  escalation, the `RuntimeDefault` seccomp profile and without a service account token.
- The Secret is mounted read-only for the pod only (mode 0400; with the `fsGroup` of the pod, Kubernetes
  makes it 0440 for the pod's own group). The broker never logs the token, the password or a
  kubeconfig.
- `/healthz`, `/readyz`, `/docs` and `/docs/json` need no authentication; everything under `/v2`
  needs the broker credentials.
- Swagger UI sends real requests: with "Try it out", a provision creates a real cluster. Switch it
  off with `config.SWAGGER_UI_ENABLED='false'` if the broker is reachable from untrusted networks.

## Upgrade and uninstall

```sh
helm upgrade osb oci://ghcr.io/alirionx/charts/capi-navigator-osb --version <new version> \
  --namespace capi-navigator-osb --reuse-values
helm uninstall osb --namespace capi-navigator-osb
```

Uninstalling the broker leaves the clusters of existing service instances untouched: they live in
CAPI Navigator. Delete the service instances in Cloud Foundry first (`cf delete-service`) if the
clusters shall go too, then remove the broker (`cf delete-service-broker capi-navigator`).
