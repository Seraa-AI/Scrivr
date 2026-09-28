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
when the computed page geometry is unchanged, including header and footer
band positions. If measuring tokens wraps a band and changes pagination, the
contributors see the new flow before the loop accepts convergence.

Streamed layout now resumes from a replayable snapshot of both the paginated
cursor and continuous-flow cursor. A pass owns its growing page buffers, so
retries cannot duplicate body blocks. When chrome changes the saved geometry,
layout replays the consumed prefix while preserving the chunk's progress — and
publishes a new layout version when it does, since pages already painted have
moved and their tiles must repaint before the caret is drawn against them. A
partial layout's cached tail is never reused: it has a cutoff rather than a
tail, and copying from it would truncate the document at the last chunk.

Chrome painting now receives the editor's font modifiers through the page
renderer. Live header/footer measurement uses the same modifiers as stored
measurement, preserving custom token typography and line geometry on entry
to editing.

**Breaking (schema):** `pageNumber`, `totalPages` and `date` no longer declare
`width`/`height` attrs — their `InlineStrategy` measures them. Persisted
documents are unaffected, since ProseMirror ignores attrs a spec does not
declare. But `inlineRegistry` is now **required** to lay these tokens out, not
merely available: a measurement path that omits it drops them entirely and
warns, where it previously reserved a wrong-but-visible box. All in-repo paths
pass it; direct callers of `runMiniPipeline` must.
