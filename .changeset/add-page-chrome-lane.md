---
"@scrivr/core": patch
---

Add `addPageChrome()` extension lane and the iterative chrome aggregator loop. Extensions can now contribute a `PageChromeContribution` (headers, footers, footnote bands, margin notes) that reserves per-page vertical space and paints on top of the content canvas. Zero shipping contributors yet — this lays the groundwork for the HeaderFooter plugin.

Internal refactor: `paginateFlow` now takes an options bag and returns per-page `metrics[]` directly; `runFlowPipeline` was extracted from `_runPipelineBody` so the aggregator can iterate measurement + pagination without re-running float/fragment passes. `DocumentLayout._chromePayloads` always populated (possibly empty) to seed the next run's contributor state.

Also fixes `computePageMetrics` returning a bogus `footerTop` in pageless mode (subtracted `margins.bottom` even though pageless has no footer band).
