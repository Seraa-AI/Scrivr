# syntax=docker.io/docker/dockerfile:1

FROM node:24-alpine AS base

FROM base AS builder
RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm -g install turbo@^2

COPY . .
RUN turbo prune @scrivr/docs --docker

FROM base AS installer
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
ENV COREPACK_DISABLE_DOWNLOAD_SIGNATURE_CHECK=1

RUN apk update
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Full source must be copied BEFORE `pnpm install` because apps/docs's
# postinstall hook runs `fumadocs-mdx`, which reads `apps/docs/source.config.ts`.
# The original split (json-first for dep-install caching, then full) is broken
# by that postinstall dependency. Copy both here; this sacrifices the install-
# layer cache hit for source-only changes, but is the minimal correct fix.
# TODO: revisit with a BuildKit cache mount (`--mount=type=cache,target=...`)
# for the pnpm store to get the perf back without the ordering hack.
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/full/ .

# Repo-root shared configs are NOT included by `turbo prune --docker` — it only
# copies files referenced by workspace package.json manifests. `tsconfig.base.json`
# lives at the repo root and every package's tsconfig.json extends it, so we
# pull it directly from the builder stage (which did `COPY . .`). Without this,
# tsup's DTS build fails with TS5083 and cascading "Cannot find module" errors
# because TypeScript has no base config to inherit moduleResolution from.
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json

RUN pnpm install --frozen-lockfile

RUN pnpm turbo run build --filter=@scrivr/docs...

FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 scrivr
RUN adduser --system --uid 1001 scrivr
USER scrivr
COPY --from=installer /app .

ENV NITRO_PORT=3000
ENV NITRO_HOST=0.0.0.0
EXPOSE 3000

CMD ["dumb-init", "node", "apps/docs/.output/server/index.mjs"]
