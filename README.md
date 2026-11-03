# CAPI Navigator Service Broker

> **Status:** not started yet – this is a placeholder.

An [Open Service Broker](https://www.openservicebrokerapi.org/) (API v2.17) that lets Cloud Foundry
users order Kubernetes clusters from [CAPI Navigator](https://github.com/alirionx/capi-navigator).

- `cf marketplace` lists one plan per **cluster blueprint** of CAPI Navigator.
- `cf create-service` creates a cluster from the blueprint, with the parameters it allows.
- `cf bind-service` / `cf create-service-key` hands out the cluster's kubeconfig.
- `cf delete-service` deletes the cluster with cleanup.

The broker is deliberately small and stateless: a thin translation layer between the OSB API and
the REST API of CAPI Navigator. It stores no state of its own.

See [docs/requirements.md](docs/requirements.md) for the requirements and the plan.
