# OSB4-F-01: one image, non-root, works with a read-only root file system (ADR-0002).

FROM node:26-bookworm-slim AS base
# Node.js 26 ships without corepack; pnpm in the version of package.json.
RUN npm install --global --no-fund --no-audit pnpm@12.16.1
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:26-bookworm-slim AS runtime
# Set by the release workflow from the tag; local builds are development versions.
ARG APP_VERSION=0.0.0-dev
# NODE_USE_ENV_PROXY: outbound requests honour HTTPS_PROXY, HTTP_PROXY and NO_PROXY when set.
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=8080 \
    NODE_USE_ENV_PROXY=1
WORKDIR /app
COPY --from=prod-deps /src/node_modules node_modules
COPY --from=build /src/dist dist
COPY package.json LICENSE NOTICE ./
# Numeric (the user "node"), so Kubernetes can verify runAsNonRoot. Files stay owned by root:
# the process cannot change its own code.
USER 1000:1000
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.js"]
