---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

Header and footer tokens now reserve the space they actually paint.

Chrome was measured without an inline registry, so an inline atom in a header
fell back to whatever width its node spec declared. `pageNumber` declared 7px:
a header read "428" but was laid out as though it read "1", overlapping
whatever sat beside it and mispositioning every right-aligned or centred band.
The date token was worse — a fixed 60px for a string whose width depends on
the locale.

`MiniPipelineOptions` and `PageChromeMeasureInput` now carry `inlineRegistry`,
and `runPipeline` populates it, so a chrome contributor measures its atoms with
the same strategies that will paint them. `InlineRegistry` is exported from
`@scrivr/core` so an extension can build one.

Two further fixes to the width itself:

- Digits were counted with `ceil(log10(n))`, which is one short at every exact
  power of ten. A ten-page document reserved a single digit and painted two.
- The token strategies read the page count from a module context that painting
  also writes, per page, as it draws. `resolveChrome` now seeds it from the
  flow layout, so a measurement answers from the document rather than from
  whichever page was painted last, and reports `stable: false` until it has
  this run's count — a count remembered from the previous run predates the
  edit being laid out, and during a streamed load belongs to a partial layout.

To keep that verification cheap, the chrome aggregator no longer re-paginates
when an iteration reserves exactly what the last one did. A contributor that
asks for another look without moving a band now pays for the measurement, not
for the whole document.

**Breaking (schema):** `pageNumber`, `totalPages` and `date` no longer declare
`width`/`height` attrs — their `InlineStrategy` measures them. Persisted
documents are unaffected, since ProseMirror ignores attrs a spec does not
declare. But `inlineRegistry` is now **required** to lay these tokens out, not
merely available: a measurement path that omits it drops them entirely and
warns, where it previously reserved a wrong-but-visible box. All in-repo paths
pass it; direct callers of `runMiniPipeline` must.
