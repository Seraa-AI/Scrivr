---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
---

refactor(layout): per-page PageMetrics, runMiniPipeline, recursion guard

Internal refactor to `@scrivr/core`'s layout engine. Zero behavior change — all 566 tests pass unchanged.

### New primitives

- `PageMetrics` — per-page geometry bundle (contentTop, contentBottom, contentHeight, contentWidth, header/footer heights). Replaces raw `margins.top` / `pageHeight - margins.bottom` arithmetic throughout the pipeline.
- `computePageMetrics` — pure function deriving PageMetrics from PageConfig + chrome reservations.
- `ChromeContribution` / `ResolvedChrome` — types for future chrome contributors (headers, footers, footnotes).
- `fitLinesInCapacity` — shared line-fitting primitive extracted from paginateFlow's split loop.
- `runMiniPipeline` — measurement-only pipeline for mini-documents (headers, footers, footnote bodies). Safe to call from chrome contributor hooks without triggering recursive pagination.
- Recursion guard on `runPipeline` that throws with a readable error pointing at `runMiniPipeline`.

### Refactored hot paths

- `paginateFlow` reads all vertical positions through `metricsFor(pageNumber)` instead of raw margin arithmetic (10 call sites).
- `applyFloatLayout` uses `metricsForPage` helper across 9 call sites (float placement, exclusion re-layout, overflow cascade).
- `DocumentLayout` gains optional `metrics[]`, `runId`, `convergence`, `iterationCount` fields.
- `MeasureCacheEntry` gains `placedRunId` / `placedContentTop` for the early-termination guard to detect chrome configuration changes between runs.
- `EMPTY_RESOLVED_CHROME` is `Object.freeze`d to prevent accidental mutation.

### Test coverage

566 tests passing (555 pre-existing + 11 new covering PageMetrics, fitLinesInCapacity, runMiniPipeline, and the recursion guard).
