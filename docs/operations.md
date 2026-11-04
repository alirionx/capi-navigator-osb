# Operating the CAPI Navigator service broker

This guide is for operators who connect a Cloud Foundry to CAPI Navigator (OSB4-F-02). The broker
offers the cluster blueprints of one CAPI Navigator connection as plans of one service offering:
`cf create-service` creates a Kubernetes cluster from a blueprint, `cf bind-service` or
`cf create-service-key` hands out its kubeconfig, `cf delete-service` deletes it.

The broker is stateless: everything it needs lives on the clusters in CAPI Navigator (labels).
You can run several replicas, restart it at any time and run it anywhere that reaches CAPI
Navigator and is reached by the Cloud Controller.

## 1. Prepare CAPI Navigator

You need CAPI Navigator with cluster blueprints (FP-34; first release 0.16.0, until then `main`
at commit `05240f3` or later) and an admin who can manage users and blueprints.

1. **Blueprints.** Create the blueprints you want to offer on the blueprints page, all on the
   connection the broker will use. Each blueprint becomes one plan; its parameters (workers,
   machine size, Kubernetes version) become the plan's parameters.
2. **Role.** Create a role with the permissions `view`, `clusters.create`, `clusters.delete` and
   `clusters.kubeconfig`.
3. **Technical user.** Create a technical user (e.g. `osb-broker`) and assign the role:
   - `clusters.create`, `clusters.delete` and `clusters.kubeconfig` limited to the connection and
     namespace(s) of the blueprints;
   - `view` cannot be limited: the user can read every cluster and blueprint of the app, but
     change none outside its scope. If your roles are split, give `view` as an unlimited
     assignment.
4. **Token.** Generate an API token for the technical user (`capin_…`). It is shown once. Tokens
   expire (default 90 days, at most 365): note the date and rotate the token before it expires.
   An expired token makes `/readyz` fail and every request answer `500`.

Every call of the broker is audited in CAPI Navigator under this user and token name.

## 2. Configuration

All settings are environment variables, checked at startup; an invalid setting stops the broker
with a message that names the variable, never its value.

| Variable                       | Default                                              | Meaning                                                                         |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `CAPIN_URL`                    | –                                                    | URL of CAPI Navigator, e.g. `https://capi-navigator.example.com`                |
| `CAPIN_CONNECTION`             | –                                                    | Connection whose blueprints are offered                                         |
| `CAPIN_TOKEN` / `_FILE`        | –                                                    | API token of the technical user; prefer the file (mode 600)                     |
| `CAPIN_TIMEOUT_SECONDS`        | `15`                                                 | Timeout of one call to CAPI Navigator                                           |
| `BROKER_USERNAME`              | –                                                    | Basic auth user Cloud Foundry uses                                              |
| `BROKER_PASSWORD` / `_FILE`    | –                                                    | Basic auth password; prefer the file                                            |
| `OFFERING_NAME`                | `kubernetes-cluster`                                 | Name in `cf marketplace`                                                        |
| `OFFERING_ID`                  | `0b0c9e40-7db5-45ae-a810-f4459a2fad3b`               | **Never change after the first instance** (plan IDs derive from it)             |
| `OFFERING_DESCRIPTION`         | `Kubernetes clusters from CAPI Navigator blueprints` | Description in `cf marketplace`                                                 |
| `LABEL_PREFIX`                 | `osb.capi-navigator.io`                              | **Never change after the first instance** (instances are found by these labels) |
| `BLUEPRINT_FILTER`             | all                                                  | Comma-separated blueprint names; `cf-*` matches a prefix                        |
| `PLANS_FREE`                   | `true`                                               | `free` of all plans                                                             |
| `MAX_POLLING_DURATION_SECONDS` | `3600`                                               | How long Cloud Foundry waits for a create or delete                             |
| `CATALOG_CACHE_SECONDS`        | `60`                                                 | How long the catalog is cached                                                  |
| `RETRY_AFTER_SECONDS`          | `30`                                                 | Polling interval suggested to Cloud Foundry                                     |
| `SWAGGER_UI_ENABLED`           | `true`                                               | Swagger UI at `/docs`, OpenAPI document at `/docs/json`                         |
| `PORT`, `HOST`, `LOG_LEVEL`    | `8080`, `0.0.0.0`, `info`                            | Server and log level (`debug` also logs probe requests)                         |

Run **two brokers against one CAPI Navigator** only with different `OFFERING_ID` and
`LABEL_PREFIX`.

## 3. Run the broker

The image is `ghcr.io/alirionx/capi-navigator-osb:<version>`. It runs as user 1000, needs no
writable file system and no capabilities, and listens on port 8080 without TLS: put a TLS
terminating ingress or reverse proxy in front of it; Cloud Foundry should reach it over HTTPS.

Endpoints without authentication: `/healthz` (process), `/readyz` (CAPI Navigator reachable and
the token valid), `/docs` and `/docs/json`. Everything under `/v2` needs the broker credentials.

### Kubernetes (Helm)

```sh
kubectl create namespace capi-navigator-osb
kubectl -n capi-navigator-osb create secret generic osb-secrets \
  --from-file=capin-token=./capin-token --from-file=broker-password=./broker-password
helm install osb oci://ghcr.io/alirionx/charts/capi-navigator-osb --version <version> \
  -n capi-navigator-osb \
  --set config.CAPIN_URL=https://capi-navigator.example.com \
  --set config.CAPIN_CONNECTION=home \
  --set secrets.existingSecret=osb-secrets \
  --set ingress.enabled=true --set ingress.host=broker.example.com --set ingress.tlsSecret=broker-tls
```

All settings of section 2 except the secrets go under `config` in the values
(`deploy/helm/capi-navigator-osb/values.yaml`). Without `secrets.existingSecret` the chart creates
the Secret from `secrets.capinToken` and `secrets.brokerPassword`.

### Docker or Podman Compose

1. Put the configuration (`CAPIN_URL`, `CAPIN_CONNECTION`, optional settings) into `.env` next to
   `compose.yaml`.
2. Write the token and the password to `./secrets/capin-token` and `./secrets/broker-password`
   (mode 600, owned by uid 1000, the user of the container).
3. `docker compose up -d` or `podman compose up -d`.

`localhost` in `CAPIN_URL` is the container itself: for a CAPI Navigator on the same host, use the
host's address on the container network (Docker: usually `http://172.17.0.1:<port>`, or
`host.docker.internal` with `extra_hosts`).

### Docker or Podman without Compose

```sh
docker run -d --name osb --read-only --cap-drop ALL -p 8080:8080 \
  -v "$PWD/secrets:/run/secrets/osb:ro" \
  -e CAPIN_URL=https://capi-navigator.example.com -e CAPIN_CONNECTION=home \
  -e CAPIN_TOKEN_FILE=/run/secrets/osb/capin-token \
  -e BROKER_USERNAME=broker -e BROKER_PASSWORD_FILE=/run/secrets/osb/broker-password \
  ghcr.io/alirionx/capi-navigator-osb:<version>
```

## 4. Register the broker in Cloud Foundry

As Cloud Foundry admin:

```sh
cf create-service-broker capi-navigator broker '<broker password>' https://broker.example.com
cf service-access                       # plans are not visible yet
cf enable-service-access kubernetes-cluster                    # all plans, all orgs
cf enable-service-access kubernetes-cluster -p small -o my-org  # or one plan for one org
```

After you add, change or remove blueprints, refresh the catalog of Cloud Foundry:
`cf update-service-broker capi-navigator broker '<password>' https://broker.example.com`.
Cloud Foundry reads the catalog only then.

## 5. Use it (for Cloud Foundry users)

```sh
cf marketplace -e kubernetes-cluster
cf create-service kubernetes-cluster small my-k8s \
  -c '{"workerPools": {"default": {"replicas": 2}}}'
cf service my-k8s                      # "create in progress" for some minutes, then "create succeeded"
cf create-service-key my-k8s key
cf service-key my-k8s key              # credentials: kubeconfig, server, cluster, namespace
cf delete-service-key my-k8s key
cf delete-service my-k8s               # deletes the cluster with cleanup
```

The parameters of a plan are listed with `cf marketplace -e kubernetes-cluster`; values outside
the limits of the blueprint are refused with a message, and nothing is created.

### Kubeconfig as a file

`cf service-key` prints the credentials as JSON, so the kubeconfig appears as one string with `\n`.
To get it as a YAML file:

```sh
umask 077   # the file holds an admin credential: readable only by you
cf service-key my-k8s key | sed -n '/^{/,$p' | jq -r .credentials.kubeconfig > my-k8s.kubeconfig
kubectl --kubeconfig my-k8s.kubeconfig get nodes
```

In **Stratos** (Services → instance → Service Keys → expand the key), use the copy icon in the
`kubeconfig` row: it copies the YAML with its line breaks. "Copy all (JSON)" gives the escaped JSON
instead. Note that Stratos (5.5) shows the kubeconfig unmasked, including the private key: avoid
opening it while sharing your screen or taking screenshots.

## 6. Limits

- **One instance is one cluster.** Creating takes minutes; users see "in progress". There are no
  updates: plan and parameters cannot change (`cf update-service` is refused); create a new
  instance instead.
- **Admin kubeconfig.** A binding hands out the cluster's admin kubeconfig. Every developer of the
  space can read it. Unbinding revokes nothing; the kubeconfig stays valid until the instance is
  deleted. Cluster API rotates the client certificate of kubeadm clusters: an old binding may stop
  working, a new binding gets the current one.
- **Upgrades** of clusters from blueprints are done by admins in CAPI Navigator; the broker does
  not offer them.
- **Capacity.** CAPI Navigator is designed for about 50 clusters per management cluster; the
  broker enforces no limit. Use plan visibility and quotas of Cloud Foundry, and
  `BLUEPRINT_FILTER`.
- **Several CAPI Navigator connections** need several brokers (each with its own `OFFERING_ID`
  and `LABEL_PREFIX`).

## 7. Troubleshooting

| Symptom                                                                      | Cause and remedy                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/readyz` answers 503 "does not accept the token"                            | Token expired, revoked or its user disabled: generate a new token and update the Secret            |
| `cf marketplace` shows no plans                                              | `cf enable-service-access` missing; or no blueprint on `CAPIN_CONNECTION`; or `BLUEPRINT_FILTER`   |
| New blueprint missing in `cf marketplace`                                    | Run `cf update-service-broker`                                                                     |
| `create-service` fails with "refuses the token or a permission"              | Role of the technical user lacks a permission or its scope misses the blueprint's namespace        |
| `create-service` fails with a message about the address pool or the provider | A blocker in CAPI Navigator; the message and hint come from the app                                |
| `create service failed` after an hour                                        | The cluster did not become ready within `MAX_POLLING_DURATION_SECONDS`; check it in CAPI Navigator |

Logs are JSON lines, one per OSB request, with instance and binding ID and the user ID of the
Cloud Foundry user; credentials are never logged.
