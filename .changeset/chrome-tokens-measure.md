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

The token strategies size digits from the document's page count, which they
read from a module context that painting also writes per page. `resolveChrome`
now seeds that context from the flow layout, so a measurement answers from the
document instead of from whichever page was painted last. It reports
`stable: false` on the first layout of a document containing a page-count
token — there is no count to measure against yet — and converges on the second
iteration. A header that does not count pages still converges in one.

**Breaking (schema):** `pageNumber`, `totalPages` and `date` no longer declare
`width`/`height` attrs. Their `InlineStrategy` measures them. Persisted
documents are unaffected — ProseMirror ignores attrs a spec does not declare.
