---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

yOffset Phase 1: structural placement attribute for anchored images. Default `0` is a no-op — pre-Phase-1 documents render identically. Spec: `docs/anchored-objects/06-yoffset-redesign.md`.

**@scrivr/core**

- **New image attr `yOffset` (default `0`).** Vertical placement delta from the anchor flow's globalY. `imageRect.y = anchorFlow.globalY + yOffset` is now the single source of truth for paint, exclusion rects, hit-test, and PDF — every consumer reads from `placement.x/y/width/height/page`, no recomputation from anchor flow Y.
- **`AnchoredObjectPlacement` gains `globalY` and optional `clamped`.** `globalY` is the painted top in continuous global-Y coordinates (= `anchorGlobalY + yOffset`, post-clamp). `clamped: true` is set when the user-set `yOffset` was clamped to keep the image on its anchor's page — Phase 2's drag overlay will read this for the boundary indicator. `anchorGlobalY` keeps its meaning (anchor flow's globalY); the Phase 2 drag snapshot reads it.
- **Page-edge clamp (V1).** `image.page === anchor.page` is a hard invariant. A `yOffset` that would paint the image off the anchor's page is clamped silently in layout (Phase 2's drag overlay surfaces stickiness visually).
- **Square-stacking math now uses painted bottoms.** `PageLayout` previously stacked the next square image against the prior placement's *anchor flow* bottom; under non-zero `yOffset` that re-creates the "moves visually but wraps old location" bug class. Switched to `placed.globalY + height + margin`. Identical behavior when all `yOffset` values are 0.
- **Square exclusion rect uses painted Y.** `reflowFlowsAgainstSquareObject` is fed the painted `globalY`/`localY`, so text wraps the image's actual position rather than its anchor flow row.
- **Legacy `floatOffset.y` migrates to `yOffset` on read.** A non-zero `yOffset` is authoritative; the schema-default `0` falls back to `floatOffset.y` so legacy documents keep their vertical placement. New code should write `yOffset` directly.
- **Tests.** `AnchoredObjects.test.ts` covers the `yOffset` migration table (default, explicit, legacy fallback, malformed `floatOffset` shapes). `PageLayout.test.ts` asserts `yOffset=0` is a no-op, `yOffset=40` shifts paint together with anchor preserved, legacy `floatOffset.y` produces the same painted position as new `yOffset`, page-edge clamp sets `clamped` and pulls overflow back onto the page (positive and negative), and square-stacking respects painted bottoms.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version. PDF export already reads `placement.x/y/width/height/page`, so it picks up `yOffset` for free through the layout layer.
