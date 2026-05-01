# 06 — yOffset redesign: anchor as ownership, rect as placement

## Problem

The current pipeline conflates two responsibilities into the image's document position:

1. **Ownership** — which paragraph the image moves with when text reflows.
2. **Placement** — where the image actually paints, where its exclusion rect sits.

Today both come from `flow.globalY` of the paragraph that contains the image node. That coupling causes three observable problems:

- Paragraph height inflates by image height, so an image-only paragraph reserves a giant gap of vertical space.
- Vertical drag is `moveNode(oldDocPos, newDocPos)` — drop position is resolved against live layout, which is changing as the drag mutates the document. Feedback loop. Cross-page drag is the worst-affected path.
- The wrap rect always sits at the anchor's Y, so "moves visually but text wraps the old location" bugs (the legacy paint-only `floatOffset` problem) keep recurring.

## Model

Separate the two responsibilities:

```
docPos        = ownership: which paragraph the image moves with
yOffset (px)  = placement: vertical delta from the anchor's globalY
imageRect.y   = anchorFlow.globalY + yOffset
exclusionRect = imageRect ± margin
```

The flow no longer "owns" the image's vertical position — the flow only owns the *anchor*. Layout is a hybrid: text flow is structural, anchored objects are positioned rectangles, and the line breaker reacts to those rectangles via `ExclusionManager`.

The mental model for drag follows from this:

> **During drag, we are not editing the document. We are editing a rectangle in space. The document is reconciled only on drop.**

## Phase 1 — Strip image height from paragraph measurement

This is the unlock. Without it, every other phase feels broken.

**Where:** the span-extraction step that feeds `LineBreaker.breakIntoLines`. Anchored image nodes already emit `width: 0` sentinel object spans (see `blockHasAnchoredObject` in `PageLayout.ts`), but their `height` and `verticalAlign` still flow into `buildLine`'s Pass 2 metric inflation (`LineBreaker.ts:828–853`).

**Change:** when the extractor sees an image with `normalizeImageAttrs(node).wrapMode !== "inline"`, emit `{ kind: "object", width: 0, height: 0, verticalAlign: "baseline" }` — a pure docPos sentinel. `buildLine`'s height-inflation branches no-op on height=0.

**Effect:** an image-only paragraph measures to one default font line, not "image height + line." The image still paints — it's resolved out of `LayoutPage.anchoredObjects[]`.

**Validation invariants** (must pass before moving to Phase 2):

- Empty image-only paragraph height = 1 default font line, **not** image height.
- Caret lands correctly on the zero-width sentinel inside the image-only paragraph.
- Selection across the anchor paragraph doesn't jump or skip the image's docPos.
- Wrap layout in adjacent paragraphs is unchanged (because exclusion rect is still computed from `LayoutPage.anchoredObjects`, which Phase 1 doesn't touch).

**Test impact:** many `PageLayout.test.ts` assertions encode "block.height includes image height." Expect a churn diff on those. The wrap-zone tests should be unaffected.

## Phase 2 — `yOffset` as a structural attribute

**Schema** (`packages/core/src/extensions/built-in/Image.ts`):
```ts
yOffset: { default: 0 }
```

**`normalizeImageAttrs`** (`AnchoredObjects.ts`) — single line absorbs the legacy paint-only `floatOffset.y`:
```ts
yOffset: numberOrDefault(a.yOffset, numberOrDefault(a.floatOffset?.y, 0))
```

**Single insertion point** in `applyFloatLayout` / `resolveAnchoredObjects` (`PageLayout.ts:~599`):
```ts
const objectGlobalY = anchorFlow.globalY + attrs.yOffset;
```

That one line is the whole semantic change. Everything downstream — exclusion rect, paint coords, PDF, hit-testing, `getNodeRect`, drag handles — already reads from `LayoutPage.anchoredObjects[].globalY`. Single source of truth.

**Cache invalidation:** `computeInputHash` (`PageLayout.ts:1481`) must include `yOffset`. One line.

### Page-edge policy (V1: clamp)

If `yOffset` lifts the image above the page top or pushes it past the bottom, the rect would land on a different page than its anchor. V1 policy: **clamp `yOffset` so the image stays on its anchor's page**.

**This creates a new invariant:**
```
image.page === anchor.page
```

Consequences:
- No split rects, no multi-page exclusion, no cross-page hit-testing complexity.
- Dragging near a page edge "sticks" — the image stops moving when it hits the page boundary.
- This stickiness must be **visually explicit** (e.g. ghost goes red, or stops at the boundary), never silent. Silent clamping is a debugging trap.

V2 evolution (deferred): per-page rect splitting, similar to the existing top-bottom split-at-boundary mechanism. The architecture supports it; the V1 invariant is the simplification, not a permanent constraint.

### Subsumed bugs / TODOs

- `bug_float_offset_spacing_regression.md` — top-bottom float negative `floatOffset.y` excess spacing. Subsumed: `yOffset` is now structural, not paint-only.
- `bug_float_anchor_page_separation.md` — image overflows but anchor stays. Subsumed by the page-edge clamp invariant.
- `todo_anchor_stacked_reflow.md` — multi-image overlap on same flow. Becomes trivial under this model: every image is its own rect via `ExclusionManager`, no per-paragraph compounding.

## Phase 3 — Drag rewrite (where the bug actually dies)

The current bug:
```
drag → mutate docPos → layout changes → docPos target shifts → chaos
```

The fix is the gesture-begin snapshot. Drag-time math reads the snapshot, never live layout.

**Snapshot at `onPointerDown`** — both fields, both frozen for the gesture's lifetime:
```ts
start = {
  anchorDocPos: number,
  anchorGlobalY: number,
}
```

If `anchorGlobalY` is recomputed mid-drag, the bug returns. Snapshot or die.

**Same-page drop** (no page boundary crossed):
```ts
const newYOffset = clamp(drop.imageGlobalY - start.anchorGlobalY, pageBounds);
tr.setNodeAttrs(start.anchorDocPos, {
  xAlign: "custom",
  x: drop.x,
  yOffset: newYOffset,
});
```
docPos does not change. One transaction, one undo step.

**Cross-page drop** (anchor must move to a paragraph on the new page):
```ts
const newAnchor = findAnchorAt(drop.coords);
const adjustedYOffset = drop.imageGlobalY - newAnchor.globalY;
tr.moveNode(start.anchorDocPos, newAnchor.pos)
  .setNodeAttrs(newAnchor.pos, {
    xAlign: "custom",
    x: drop.x,
    yOffset: adjustedYOffset,
  });
```
The two-op transaction is still a single undo step. Visual position is preserved by construction.

**Live ghost during drag:** the existing `pendingAnchoredDrag` overlay (`feedback_anchored_drag_overlay_v1.md`) already paints the image at the cursor's current Y without committing. Phase 3 changes the commit, not the ghost. No new overlay plumbing.

**What's eliminated:**
- Paragraph-snap behavior during drag (no more "vertical drag jumps to the next paragraph's top").
- Cross-page flicker (no more docPos churn during the gesture).
- Feedback loop between drag and layout.

## Phase 4 — Re-anchor on drop (polish, with anti-jitter)

After commit, optionally swap to a closer anchor while preserving visual position:

```ts
const oldImageGlobalY = oldAnchor.globalY + oldYOffset;
const candidate = findClosestParagraphAt(oldImageGlobalY);

const RE_ANCHOR_THRESHOLD = 24; // px; tune to taste
const wouldReduce = Math.abs(oldYOffset) - Math.abs(candidate.globalY - oldImageGlobalY);
if (wouldReduce > RE_ANCHOR_THRESHOLD) {
  const newYOffset = oldImageGlobalY - candidate.globalY;
  // moveNode + setAttrs
}
```

Constraints:
- **Never re-anchor across pages.** Page boundaries belong to Phase 3's cross-page path, which is explicit user intent.
- **Threshold-gated.** Without the `wouldReduce > THRESHOLD` guard, small drags trigger anchor jitter — every drop changes the anchor by a few pixels and undo history fills with anchor swaps. The threshold makes re-anchor a meaningful event, not a side effect.

This phase is independent of phases 1–3 and ships separately.

## Invariants the redesign establishes

1. `paragraph.height === text.height` (no image contribution).
2. `image.page === anchor.page` (V1 page-edge clamp).
3. Exclusion rect is the single source of truth for paint, wrap, hit-test, PDF.
4. During drag, document structure is read-only; only the gesture-end commit mutates the doc.
5. `yOffset` is structural — every consumer that reads image position must read it through `LayoutPage.anchoredObjects[].globalY`, never recompute from `flow.globalY` directly.

## Future evolution

`yOffset` is anchor-relative ("move with text"). Word and Docs both also support **page-relative** positioning ("fix position on page"):

```ts
positionMode: "move-with-text" | "fixed-on-page"
```

Under `fixed-on-page`, the image's globalY is computed from page top + offset, ignoring the anchor flow entirely. The anchor is then purely an undo/select grouping.

The current architecture supports this trivially — it's a `switch` in the `objectGlobalY` computation. The schema already has a `positionMode: "move-with-text"` field as a placeholder. Add the `fixed-on-page` branch when a concrete consumer needs it (per `project_page_orientation_roadmap.md` shipping discipline).

## Recommended ship order

1. **Phase 1 alone** — validate the three Phase-1 invariants against the demo doc and existing test suite. Test diff is loud; resolve before moving on.
2. **Phase 2** — yOffset attr, single-line layout change, cache hash, clamp policy. No drag changes yet. Default `yOffset: 0` keeps all existing docs visually identical.
3. **Phase 3** — drag rewrite. The user-visible win (cross-page drag stops flickering) lands here.
4. **Phase 4** — re-anchor polish. Independent, optional, can defer past the initial PR.

Each phase is independently shippable and revertible. Resist combining.
