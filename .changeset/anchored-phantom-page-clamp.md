---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — defensive clamp so `AnchoredObjectPlacement.page` never
exceeds `layout.pages.length`.

Under extreme inputs (huge image height + dense float packing + extreme
`yOffset`), the anchored-object solver picks `placement.page` based on
geometry before pagination finalizes the page count. If no flow content
lands on that geometry-derived page, the page list truncates but the
placement keeps the higher index — and downstream consumers (PDF export
indexed by page, hit-testing reaching for `CharacterMap` on a
non-existent page) reference a page that doesn't exist.

`runPipeline` now calls `clampPlacementsToPages(mergedPlacements,
pages.length)` at both finalization branches (partial-stream and
complete) so every placement that survives into `layout.anchoredObjects`
satisfies `placement.page <= layout.pages.length`. The clamp leaves
`placement.y` untouched — the float was already painting off the bottom
of its intended page; the visual is no worse, but every loop that
iterates pages can now trust the index. Common case stays
allocation-free (returns the input reference when no clamping is
needed).

`clampPlacementsToPages` is exported from `./layout/PageLayout` for
custom layout consumers that build placements outside `runPipeline`
(advanced extension authors, format exporters); the package's public
surface is unchanged.

Tests: 5 new cases in `PageLayout.test.ts` cover the clamp, the
`y`-preservation contract, the allocation-free no-op path, the empty
input, and the `pageCount === 0` guard.

Other packages: lockstep version bump, no behavior change.
