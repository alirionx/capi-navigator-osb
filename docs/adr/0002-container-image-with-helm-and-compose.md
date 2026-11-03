# ADR-0002: Container image with a Helm chart and a Compose file

- Status: accepted
- Date: 2026-11-04
- Pack: OSB-4 (open decision 2, OSB4-F-01)

## Context

OSB4-F-01 asks for a container image and a way to run it: a Helm chart, a CF app manifest or both.
CAPI Navigator itself ships as a container image with a Helm chart, and the broker runs next to it
rather than inside Cloud Foundry.

## Decision

- The broker ships as **one OCI container image** (non-root, read-only root file system), built in
  CI on tags (NF-04).
- It runs on **Docker, Podman and Kubernetes**:
  - Kubernetes: a **Helm chart** in `deploy/helm/`, like CAPI Navigator.
  - Docker and Podman: an example `compose.yaml`, which works with `docker compose` and
    `podman compose`; a plain `docker run` / `podman run` is documented as well.
- Configuration comes only from environment variables and mounted files (the app token, the
  broker password), so every runtime is configured the same way.
- **No CF app** (`cf push`, buildpacks, app manifest).

## Consequences

- Cloud Foundry reaches the broker over HTTPS from outside; TLS ends at the ingress or a reverse
  proxy in front of the container, not in the broker.
- The live acceptance (OSB4-F-03) runs the broker as a container.
