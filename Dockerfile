# syntax=docker/dockerfile:1
#
# One Dockerfile for all six deployables, selected with --build-arg SERVICE=<name>.
#
# Why one and not six (D2 in the phase-0 pre-brief): the services are
# near-identical Node processes, so six copies means the same fix applied six
# times and drifting in five of them. Independent deployability lives in the
# pipeline and the image tag, not in the file the image is built from — CI
# builds and pushes six *separate images* from this one file.
#
# Stages:
#   deps       install everything (dev + prod), cached on package.json files alone
#   dev        target used by docker-compose; runs tsx watch
#   build      tsup-bundle one service to dist/
#   prod-deps  install runtime dependencies only
#   runner     final image: dist/ + prod node_modules, non-root
#   migrate    the schema, as its own image — no SERVICE, see the stage

ARG NODE_VERSION=24-alpine

# ─── base ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ─── manifests ───────────────────────────────────────────────────────────────
# Copied on their own, before any source, so that editing a .ts file does not
# invalidate the install layer. Every package.json is listed explicitly: a bare
# `COPY . .` here would make the cache useless, which is the single most common
# reason Node images rebuild slowly.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json      packages/shared/
COPY packages/db/package.json          packages/db/
COPY services/gateway/package.json     services/gateway/
COPY services/users/package.json       services/users/
COPY services/questions/package.json   services/questions/
COPY services/matching/package.json    services/matching/
COPY services/collab/package.json      services/collab/
COPY services/stats/package.json       services/stats/

# ─── deps (dev + prod) ───────────────────────────────────────────────────────
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── dev (docker-compose target) ─────────────────────────────────────────────
# Source is bind-mounted by compose rather than copied, so edits are picked up
# by tsx watch without a rebuild. Only src/ directories are mounted — mounting
# /app would shadow node_modules and break the container instantly.
FROM deps AS dev
ARG SERVICE
ENV SERVICE=${SERVICE}
COPY . .
CMD ["sh", "-c", "pnpm --filter @deepcs/${SERVICE} dev"]

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
ARG SERVICE
COPY . .
RUN pnpm --filter "@deepcs/${SERVICE}" build

# ─── prod-deps ───────────────────────────────────────────────────────────────
# A second, production-only install. pnpm's symlinks are relative and resolve
# inside /app (the virtual store is /app/node_modules/.pnpm), so both trees can
# be copied into the runner and still resolve.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ─── runner ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules                    ./node_modules
COPY --from=prod-deps /app/services/${SERVICE}/node_modules ./services/${SERVICE}/node_modules
COPY --from=build     /app/services/${SERVICE}/dist         ./services/${SERVICE}/dist

# @deepcs/shared is deliberately absent from this image: tsup inlined it into
# dist (see the service's tsup.config.ts). The dangling workspace symlink left
# in node_modules is never resolved because nothing imports it at runtime.

USER node
ENV SERVICE=${SERVICE}
CMD ["sh", "-c", "node services/${SERVICE}/dist/index.js"]

# ─── migrate ─────────────────────────────────────────────────────────────────
# The schema, as an image the cluster can run as a Job — e.g.
#   docker build --target migrate -t deepcs/migrate:local .
#
# It takes no SERVICE build-arg, because it is not one of the six: it applies
# the numbered .sql files and exits. `runner` cannot do this job — it copies
# services/${SERVICE}/dist and nothing else, so the migrations are not in it.
#
# Compose runs the same migration from the `dev` target instead, because that
# stage is already built there for the bind mounts. Nothing on the cluster is
# bind-mounted, so building the whole dev tree to run forty lines of .mjs would
# be several hundred megabytes to move through `kind load`.
#
# Connects as the owner role, the one role allowed to create schemas and hand
# out grants — which is exactly what the six service roles are forbidden (ADR-09).
FROM node:${NODE_VERSION} AS migrate
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules             ./node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY packages/db/migrate.mjs ./packages/db/migrate.mjs
COPY packages/db/migrations  ./packages/db/migrations

USER node
CMD ["node", "packages/db/migrate.mjs"]
