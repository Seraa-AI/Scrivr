---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — fix text-selection drag getting stuck at the source page
when the cursor crosses into a page whose CharacterMap has not been
populated yet.

`PointerController.handlePointerMove` calls
`editor.charMap.posAtCoords(x, y, page)` on every frame of a text-select
drag. `posAtCoords` is page-scoped: on a destination page whose glyphs
have not been registered (the common case during the first drag into an
off-cursor page), `nearestLine` returns `undefined`, the lookup falls
through to `0`, and `setSelection(anchor, 0)` collapses the selection to
the document start — visually appearing as "drag stuck at the source
page" because the destination half never receives a valid head.

The anchored-object drag handler in the same controller already mitigates
this: it calls `editor.ensurePagePopulated(hit.page)` before resolving
`posAtCoords` (see `resolveDragTargetDocPos`). Text drag now does the
same. The selection head now updates correctly as the pointer enters
each new page during a drag.

In the same fix, mid-drag pointermoves whose `hitTest` result lands in
the inter-page gap (`hit.gap === true`) are now skipped instead of
re-running `posAtCoords` with `docY` clamped to the source-page bottom.
Without this, every gap-traversal frame would re-collapse the selection
head to end-of-source-page on the way down. The last valid selection now
sticks until the pointer enters real page content again.

Tests: three new cases in `PointerController.test.ts` cover (a) the
`ensurePagePopulated` call during a cross-page drag, (b) the gap-skip
behavior, and (c) the end-to-end selection-head update when dragging
into page 2.

Other packages: lockstep version bump, no behavior change.
