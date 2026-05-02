---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Anchored-object yOffset deferred fixes — closes the items left open by the prior yOffset PR. Core gets the architecture work; export-pdf gets paint-order parity; react/plugins/export-markdown bump in lockstep with no code changes.

**@scrivr/core**

- **Phase 5 V2 — FlowBlock rip-out for top-bottom.** The `partKind: "anchored-object"` synthetic FlowBlock split (with its `before / image / after` paragraph fragmentation in `buildBlockFlow`) is gone. Top-bottom now contributes a `side: "full"` rect via `addFullWidthRect` and reflows flows through the same `reflowFlowsAgainstExclusions` path as square. One path, one question. Removes `topBottomImageInfo`, the four `anchoredObject*` fields on `FlowBlock`, and the top-bottom `yOffset` suppression hack in `PointerController` that Phase 5 V1 needed.
- **`zIndex` attribute on image nodes** (default `0`). Two new helpers — `compareAnchoredObjectPaintOrder` (asc by zIndex, then docPos) and `compareAnchoredObjectHitOrder` (paint order reversed) — drive painting in `PageRenderer`/`export-pdf` and hit-testing in `PointerController`. Schema attr round-trips through PM as a normal number.
- **Cross-page exact-position drop.** `PointerController.commitAnchoredDrag` now resolves the destination `yOffset` against the new anchor's globalY instead of resetting to `0`. The image lands at the cursor position rather than snapping to the new anchor's natural row. Closes the deferred TODO from the prior PR.
- **Same-page re-anchor with threshold.** `resolveSamePageReanchor` re-parents an image to the closest paragraph when the committed yOffset would shrink dramatically (past `RE_ANCHOR_THRESHOLD_PX = 24`). Without this the offset accumulates across many drags.
- **Inline image drag overlay.** Inline images now show the same translucent ghost + caret marker as anchored drags, with `disabled = true` styling for in-gap drops. Mirrors the anchored-drag overlay state contract.
- **`pageStartGlobal` / `pageLocalYToGlobal` lifted to `PageMetrics`** (`pageStartGlobalForMetrics`, `pageLocalYToGlobalForMetrics`, `PageFlowMetrics` type). One implementation, called from both `PageLayout` and `PointerController`.
- **`pageRectsDigest` invalidates pagination cache** when anchored-object placements change between layout runs. The runFlowPipeline path now drops `previousLayout` for pagination if the digest mismatches.
- **Magic-number constants extracted.** `DRAG_THRESHOLD_PX`, `AXIS_STILL_THRESHOLD_PX`, `RE_ANCHOR_THRESHOLD_PX` are file-level `const`s in PointerController.
- **Tests.** New tests for: zIndex paint/hit order helpers (3), pageRectsDigest invalidation (2), same-page re-anchor (2), cross-page yOffset (1). Existing top-bottom tests updated to the unified-rect shape.

**@scrivr/export-pdf**

- Paints anchored objects in `compareAnchoredObjectPaintOrder` to match the canvas renderer. Without this, zIndex would silently differ between PDF and on-screen output.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
