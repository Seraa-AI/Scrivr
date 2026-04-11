---
---

chore(docs): fix Docker deployment pipeline and gate AI features behind build-time flag

All changes in this PR are scoped to `apps/docs`, which is a private workspace app and not a published package. No version bump is needed for `@scrivr/core`, `@scrivr/react`, `@scrivr/plugins`, or `@scrivr/export`. This changeset exists to satisfy the CI requirement that every PR include a changeset file.

## Summary

**Docker deployment fixes** (`apps/docs/Dockerfile`):
- Fix fumadocs-mdx postinstall ordering — copy full source before `pnpm install` so the hook can read `apps/docs/source.config.ts`
- Include `tsconfig.base.json` explicitly — `turbo prune --docker` omits non-workspace root configs, which caused TS5083 and cascading module-resolution errors
- Add BuildKit syntax directive (`# syntax=docker.io/docker/dockerfile:1`)
- Switch to `pnpm install --frozen-lockfile` for stricter lockfile enforcement

**Playground schema fix** (`apps/docs/src/playground/demoContent.ts`):
- Demo doc JSON used `bullet_list` / `ordered_list` / `list_item` (snake_case from stale CLAUDE.md docs), but the actual core schema registers `bulletList` / `orderedList` / `listItem` (camelCase). Schema.nodeFromJSON threw RangeError on hydration. Updated the demo to use the correct names.

**AI feature gating** (`apps/docs/src/playground/Playground.tsx` + new files):
- Gated `AiToolkit`, `ChatPanel`, and `AiSuggestionCardsPanel` behind a build-time `AI_ENABLED` flag (`import.meta.env.DEV || import.meta.env.VITE_AI_ENABLED === "true"`). Production bundles tree-shake the entire AI code path (~100KB saved).
- Added `apps/docs/src/lib/env.ts` — a Zod-validated runtime env module for `VITE_COLLAB` and `VITE_WS_URL`, inspired by the shared `createEnv` pattern. Replaces the `(import.meta as unknown)` cast.
- Added `apps/docs/.env.example` as a committed reference for contributors.
- Added `apps/docs/content/docs/guides/ai-features.mdx` explaining why AI is off on the public playground, how to enable it locally, and the two-lane runtime-vs-build-time env split.
- Production-mode playground UI shows Track Changes full-height (no tab bar) with a discreet "AI · local dev" chip in the header linking to the docs page.

## Why no package version bump

Nothing in `packages/*` changed. The core engine, React adapter, plugins, and export package are all untouched. This PR is pure apps/docs plumbing: Docker build fixes, a playground demo content fix, and AI feature gating in the docs app itself. Consumers of `@scrivr/core` / `@scrivr/react` / `@scrivr/plugins` / `@scrivr/export` have no reason to upgrade.
