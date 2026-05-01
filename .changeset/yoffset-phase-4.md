---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

yOffset Phase 4: square reflow shares one `ExclusionManager` per page. Multi-image-on-same-flow now wraps against the union of all rects rather than the last one. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 4.

**@scrivr/core**

- **`resolveAnchoredObjects` owns a `Map<pageNumber, ExclusionManager>`.** When a square anchor is processed, the rect is added to the page's shared manager *before* the reflow call. Subsequent square anchors on the same page accumulate into the same manager, so flows that overlap multiple images see the union of all rects via `getAvailableSegments`.
- **`reflowFlowsAgainstSquareObject` → `reflowFlowsAgainstSquareExclusions`.** The function no longer creates its own `ExclusionManager` or calls `addRect`. It receives the shared manager and a `{ pageNumber, zoneTop, zoneBottom, contentX, contentWidth }` zone for early-exit bounds. The `lineSpaceProvider` queries the manager directly so each line sees every rect added so far on the page.
- **Latent bug fix.** Two square images in the same paragraph (or in adjacent paragraphs with overlapping wrap zones) used to corrupt subsequent text wrap: the second reflow's single-rect query returned segments around image B only, overwriting the first call's result and silently positioning text underneath image A. The shared manager fixes this by construction. Tracked as `todo_anchor_stacked_reflow.md`.
- **Iteration semantics preserved for the common case.** Sequential anchors in document order — the realistic workload — re-iterate downstream flows against the current manager state, so adding a rect always reflows everything below it. Pathological out-of-document-order overlaps (anchor A late in the doc with a yOffset that places its rect above anchor B earlier in the doc) are not handled by this iteration; that's a Phase 4 follow-up if it appears in real documents.
- **Cache invalidation deferred.** Spec calls for a `pageRectsDigest` to widen the per-flow `overlapsWrapZone` cache key; this PR keeps the existing flag (set when a flow's Y intersects the current zone) and accepts that flow caching can stale when an image rect moves under yOffset. Will land in a follow-up.
- **Tests.** New `PageLayout.test.ts` test: two square images (`xAlign: "left"` and `xAlign: "right"`) on the same page with a long text paragraph below — text spans are asserted to fall entirely between the two rects' painted edges, not beneath either image.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
