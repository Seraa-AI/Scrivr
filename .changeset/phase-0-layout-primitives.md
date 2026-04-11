---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
---

refactor(layout): Phase 0 — per-page PageMetrics, runMiniPipeline, recursion guard

Internal refactor to `@scrivr/core`'s layout engine. **Zero behavior change** — all 566 tests (555 pre-existing + 11 new) pass unchanged, and the 99-test `PageLayout.test.ts` hot-loop suite produces byte-for-byte identical output.

Patch bump: although this adds new exports (`PageMetrics`, `computePageMetrics`, `ChromeContribution`, `ResolvedChrome`, `EMPTY_RESOLVED_CHROME`, `runMiniPipeline`, `fitLinesInCapacity`), they are **infrastructure scaffolding for Phase 1b+** (headers, footers, footnotes) and don't provide directly usable features to consumers today. The `@scrivr/react`, `@scrivr/plugins`, and `@scrivr/export` packages are bumped via the fixed-group config even though their source is untouched — they depend on `@scrivr/core` and should version together.

## What landed

**New primitives in `@scrivr/core`:**

- `layout/PageMetrics.ts` — `PageMetrics` interface (per-page geometry bundle), `ChromeContribution` / `ResolvedChrome` types for future chrome contributors, `computePageMetrics` pure function, `EMPTY_RESOLVED_CHROME` constant for the Phase 0 zero-contributor state
- `layout/splitLines.ts` — `fitLinesInCapacity` shared primitive (the inner "walk lines, stop at capacity" step extracted from paginateFlow's split loop)
- `layout/runMiniPipeline.ts` — measurement-only pipeline entry point for future chrome contributors that need to measure mini-documents (header content, footer content, footnote bodies) without triggering the main pipeline's chrome aggregator
- `layout/PageLayout.ts` — `_runPipelineDepth` recursion guard with a readable throw message pointing at `runMiniPipeline` as the fix

**Refactored hot paths (zero behavior change):**

- `paginateFlow` signature takes `pageConfig` + `resolved` + `metricsFor` + `runId` instead of `margins` + `contentHeight`. 10 internal call sites rewritten to route vertical-position reads through `metricsFor(pageNumber)`.
- `runPipeline` builds `EMPTY_RESOLVED_CHROME`, creates a 1-entry `metricsFor` helper, populates the new `DocumentLayout.metrics[]` array + `runId` + `convergence` + `iterationCount` fields. Body extracted into `_runPipelineBody` behind the recursion guard.
- `applyFloatLayout` adds a `metricsForPage` helper and uses it in 9 call sites across Pass 2 (float placement), Pass 3 (exclusion-zone re-layout), and Pass 3b (overflow cascade).
- `buildBlockFlow` copies two new preCached fields (`preCachedRunId`, `preCachedContentTop`) onto `FlowBlock`.

**Optional fields added to existing interfaces:**

- `DocumentLayout` — `metrics?: PageMetrics[]`, `runId?: number`, `convergence?: "stable" | "exhausted"`, `iterationCount?: number`
- `MeasureCacheEntry` — `placedRunId?: number`, `placedContentTop?: number`
- `FlowBlock` — `preCachedRunId?: number`, `preCachedContentTop?: number`

All new fields are optional so any code path that constructs these types without running the full pipeline (e.g. test fixtures) still compiles.

**Phase 1b two-guard cache invariant (dormant in Phase 0):**

The early-termination shortcut in `paginateFlow` now checks **both** that the cache entry's `preCachedRunId` matches `previousLayout.runId` AND that `preCachedContentTop` matches the current page's contentTop. In Phase 0 with zero chrome contributors, both conditions hold trivially (runId increments per run, contentTop is constant across all pages), so the shortcut hit rate is unchanged. The guard becomes load-bearing in Phase 1b when real chrome contributors can change page geometry between runs.

## What this unblocks

Per `docs/weekend-plan-2026-04-12.md`, this PR (PR 1) unblocks:

- **PR 4** (`feat/add-page-chrome-lane`) — wires the `addPageChrome()` extension lane and replaces `EMPTY_RESOLVED_CHROME` with a real chrome aggregator
- **Phase 2+** of the header/footer plan — the HeaderFooter plugin registers its `measure()` + `render()` contributions via the new lane
- **Footnote plugin** (future) — uses `runMiniPipeline` from inside its `measure()` hook to measure footnote bodies without triggering recursive pagination

## What's deliberately NOT in this PR

- No `addPageChrome()` extension lane (that's PR 4)
- No `aggregateChrome()` aggregator function (also PR 4)
- No chrome contributors (HeaderFooter plugin, footnotes — those are Phase 2+)
- `runId` is aliased to `version` (they serve the same per-run-identity purpose today; future PRs may split them if needed)

## Test coverage

- 566/566 tests passing (555 pre-existing + 11 new)
- New tests cover: `PageMetrics` zero-contributor baseline on 10 pages, stub-contributor variation (differentFirstPage emulation), pageless mode, `fitLinesInCapacity` edge cases + purity, `runMiniPipeline` basic measurement + DocumentLayout shape, recursion guard throws with correct error message

Refs:
- `docs/weekend-plan-2026-04-12.md` §PR 1 steps 1.1–1.8
- `docs/header-footer-plan.md` §3 (PageMetrics design)
- `docs/multi-surface-architecture.md` §3.4 (LayoutIterationContext forward-compat)
- `docs/multi-surface-architecture.md` §8.6 (Phase 1b two-guard invariant)
- `docs/export-extensibility.md` §6.1 (runMiniPipeline + recursion guard rationale)
