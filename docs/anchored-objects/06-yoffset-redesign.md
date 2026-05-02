# 06 — yOffset redesign: anchor as ownership, rect as placement

> **Status — landed.** Phases 1–6 plus the same-page re-anchor and
> cross-page exact-position drop polish all shipped (PRs #58 and #59).
> Top-bottom and square share one rect-driven exclusion path, `yOffset` is
> the single source of paint truth, and `zIndex` controls paint/hit order.
> Genuinely-deferred items: the per-page rect splitting at page boundaries
> alternative to V1's clamp policy (see § Page-edge policy below) and any
> `positionMode: "fixed-on-page"` work. The doc below is preserved as the
> design record; treat the "Phase N — …" headings as historical.

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

The flow no longer "owns" the image's vertical position — the flow only owns the *anchor*. Layout becomes a hybrid: text flow is structural, anchored objects are positioned rectangles, and the line breaker reacts to those rectangles via `ExclusionManager`.

The mental model for drag follows from this:

> **During drag, we are not editing the document. We are editing a rectangle in space. The document is reconciled only on drop.**

## Today's reality: square and top-bottom are not yet symmetric

The endpoint is "all wrap modes feed `ExclusionManager`," but today they don't.

**Square wrap** already follows the rect → exclusion → segments path:

```
applyFloatLayout
  → resolveAnchoredObjects (computes placement)
  → reflowFlowsAgainstSquareObject
     → ExclusionManager (one rect)
     → layoutBlock(...lineSpaceProvider) re-runs per overlapping flow
```

**Top-bottom wrap** does not. In `buildBlockFlow`, a top-bottom image is detected up-front and emitted as a special `FlowBlock`:

```ts
{ partKind: "anchored-object", height: imageHeight, spaceAfter: margin }
```

That reserves vertical flow height *before* exclusion layout runs. The comment in `resolveAnchoredObjects` confirms it: top-bottom's vertical flow is represented by the Stage-1 anchored-object block, no second clearance barrier needed.

So the migration has to convert top-bottom from a flow-height reservation into a `side: "full"` exclusion rect — that's a real phase, not a free fold.

## Phasing

The six phases land in this order. Each is independently shippable; the order is chosen so each phase's invariants hold against the previous one.

### Phase 1 — Add structural `yOffset` attribute

Pure data-model addition. Default value 0 → no visual change for any existing document.

**Schema** (`packages/core/src/extensions/built-in/Image.ts`):
```ts
yOffset: { default: 0 }
```

**`normalizeImageAttrs`** absorbs the legacy paint-only `floatOffset.y` in one line:
```ts
yOffset: numberOrDefault(a.yOffset, numberOrDefault(a.floatOffset?.y, 0))
```

**Single threading point** in `applyFloatLayout` / `resolveAnchoredObjects` (`PageLayout.ts:~599`):
```ts
const objectGlobalY = anchorFlow.globalY + attrs.yOffset;
```

Everything downstream — exclusion rect, paint coords, PDF, hit-testing, `getNodeRect`, drag handles — reads from `LayoutPage.anchoredObjects[].globalY`. Single source of truth.

**Page-edge policy (V1: clamp)** — clamp `yOffset` so the image stays on its anchor's page. New invariant: `image.page === anchor.page`. Stickiness near a page edge must be **visually explicit** (ghost goes red, or stops at boundary). Silent clamping is a debugging trap. V2 (deferred): per-page rect splitting akin to the existing top-bottom split-at-boundary.

### Phase 2 — Drag stops mutating docPos; commits yOffset

The current bug:
```
drag → mutate docPos → layout changes → docPos target shifts → chaos
```

Fix is the gesture-begin snapshot. Drag-time math reads the snapshot, never live layout.

Snapshot at `onPointerDown` — both fields, both frozen for the gesture's lifetime:
```ts
start = {
  anchorDocPos: number,
  anchorGlobalY: number,
}
```

If `anchorGlobalY` is recomputed mid-drag, the bug returns. Snapshot or die.

**Same-page drop** — pure attr update, docPos doesn't change:
```ts
const newYOffset = clamp(drop.imageGlobalY - start.anchorGlobalY, pageBounds);
tr.setNodeAttrs(start.anchorDocPos, { xAlign: "custom", x: drop.x, yOffset: newYOffset });
```

**Cross-page drop** — anchor must move; visual position preserved by construction:
```ts
const newAnchor = findAnchorAt(drop.coords);
const adjustedYOffset = drop.imageGlobalY - newAnchor.globalY;
tr.moveNode(start.anchorDocPos, newAnchor.pos)
  .setNodeAttrs(newAnchor.pos, { xAlign: "custom", x: drop.x, yOffset: adjustedYOffset });
```

The existing `pendingAnchoredDrag` overlay handles the live ghost. Phase 2 changes the commit, not the overlay.

After Phases 1+2 land, the data model and the drag interaction are correct, but paragraph height still includes image height. The system is functionally correct (drag works, exclusions work) but visually wasteful for image-only paragraphs.

### Phase 3 — Floating images stop contributing paragraph height

The visual unlock. Before this, image-only paragraphs reserve image-height of vertical space. After, they reserve one default font line.

**Where:** the span-extraction step that feeds `LineBreaker.breakIntoLines`. Anchored image nodes already emit `width: 0` sentinel object spans (see `blockHasAnchoredObject`), but their `height` and `verticalAlign` still flow into `buildLine`'s Pass 2 metric inflation (`LineBreaker.ts:828–853`).

**Change:** when the extractor sees an image with `normalizeImageAttrs(node).wrapMode !== "inline"`, emit:
```ts
{ kind: "object", width: 0, height: 0, verticalAlign: "baseline" }
```
A pure docPos sentinel. `buildLine`'s height-inflation branches no-op on height=0.

**Validation invariants** before moving to Phase 4:
- Empty image-only paragraph height = 1 default font line, not image height.
- Caret lands correctly on the zero-width sentinel inside the image-only paragraph.
- Selection across the anchor paragraph doesn't jump or skip the image's docPos.
- Wrap layout in adjacent paragraphs is unchanged.

**Test impact:** many `PageLayout.test.ts` assertions encode "block.height includes image height." Expect a churn diff on those.

### Phase 4 — Convert square reflow from per-object to page-level exclusions

Today `reflowFlowsAgainstSquareObject` is called once per anchored object inside a per-object loop. Each call builds its own single-rect `ExclusionManager`. Multi-image overlap on the same flow doesn't compound segments correctly (the `todo_anchor_stacked_reflow.md` issue).

**Change:** build one `ExclusionManager` per page in `applyFloatLayout`, populate it with all square rects, then do a single reflow pass over flows that overlap any rect. Per-object loop disappears.

**Cache invalidation widens.** `flow.overlapsWrapZone` was per-flow; under yOffset, any image's rect can move anywhere on the page, so a flow's overlap status depends on every rect on the page.

`computeInputHash` should hash the **effective exclusion geometry**, not raw image attrs:

```ts
pageRectsDigest = hash(rects.map(r => `${r.page}:${r.x}:${r.right}:${r.y}:${r.bottom}:${r.side}:${r.docPos}`))
```

Idempotent under attribute changes that don't move the rect, robust under attribute changes that do. Every flow measured against that page's exclusions includes the digest in its layout key.

### Phase 5 — Convert top-bottom from flow-block reservation to `side: "full"` exclusion

Rip out the `partKind: "anchored-object"` `FlowBlock` path in `buildBlockFlow`. Top-bottom images become rects in the same `ExclusionManager` as square wrap, with `side: "full"`. `LineBreaker` already emits `skipToY` for full-width exclusions (validated in `ExclusionManager.test.ts`).

**API correction needed in `ExclusionManager`.** A `side: "full"` rect must span the queried content width, otherwise `subtractRectFromSegments` leaves side segments and `skipToY` is silently dropped (segments.length !== 0 → skipToY suppressed in the return). Two options:

1. **Helper:** `addFullWidthRect({ page, y, bottom, contentX, contentWidth, docPos })` — call sites can't get this wrong.
2. **Validation in `addRect`:** require callers to pass content bounds for `side: "full"` rects, error or warn if rect doesn't span.

The helper option is preferred — it's a non-breaking API addition, reads naturally at the call site, and `addRect` stays minimal.

After Phase 5, top-bottom and square share one code path. The wrap-mode dispatch lives entirely in the rect's `side` property.

### Phase 6 — `zIndex` for stacking order

Now that all rects live in `LayoutPage.anchoredObjects[]`, paint and hit-test ordering is mechanical.

**Schema:** `zIndex: { default: 0 }`.

**Sort by consumer:**
- `PageRenderer` paint: ascending `zIndex`, then docPos (stable).
- Hit-test (`PointerController`, click, drag): descending `zIndex`, then reverse docPos.
- `ExclusionManager`: unsorted — exclusions are union math, z-order doesn't affect segments.

**Keep `wrapMode` and `zIndex` orthogonal.** `wrapMode` controls exclusion behavior (`square` / `top-bottom` / `behind` / `front` / `inline`). `zIndex` controls paint stacking among anchored objects. They answer different questions; folding `behind`/`front` into z-ranges is a future API simplification, not part of this work.

User-facing "Send to back" / "Bring to front" commands map to `setNodeAttrs({ zIndex: minZ - 1 | maxZ + 1 })`. Renormalize occasionally so values don't drift.

## Polish (not numbered phases)

### Re-anchor on drop with anti-jitter

After commit, optionally swap to a closer anchor while preserving visual position:

```ts
const oldImageGlobalY = oldAnchor.globalY + oldYOffset;
const candidate = findClosestParagraphAt(oldImageGlobalY);
const RE_ANCHOR_THRESHOLD = 24; // px
const wouldReduce = Math.abs(oldYOffset) - Math.abs(candidate.globalY - oldImageGlobalY);
if (wouldReduce > RE_ANCHOR_THRESHOLD) {
  const newYOffset = oldImageGlobalY - candidate.globalY;
  // moveNode + setAttrs
}
```

Constraints:
- **Never re-anchor across pages** — page boundaries belong to Phase 2's cross-page path, which is explicit user intent.
- **Threshold-gated.** Without the guard, small drags trigger anchor jitter — every drop changes the anchor by a few pixels, undo history fills with anchor swaps.

Independent of all phases; ships when the polish is needed.

## Invariants the redesign establishes

After Phases 1–5:

1. `paragraph.height === text.height` (no image contribution).
2. `image.page === anchor.page` (V1 page-edge clamp).
3. Exclusion rect is the single source of truth for paint, wrap, hit-test, PDF.
4. During drag, document structure is read-only; only the gesture-end commit mutates the doc.
5. `yOffset` is structural — every consumer reads image position through `LayoutPage.anchoredObjects[].globalY`, never recomputing from `flow.globalY`.
6. All wrap modes feed one `ExclusionManager`. The wrap-mode dispatch is the rect's `side` property.

After Phase 6, add:

7. Anchored-object paint and hit-test order = `zIndex` ascending / descending.

## Subsumed bugs / TODOs

- `bug_float_offset_spacing_regression.md` — top-bottom float negative `floatOffset.y` excess spacing. Subsumed by Phase 1: yOffset is structural, not paint-only.
- `bug_float_anchor_page_separation.md` — image overflows but anchor stays. Subsumed by Phase 1's page-edge clamp invariant.
- `todo_anchor_stacked_reflow.md` — multi-image overlap on same flow doesn't compound. Subsumed by Phase 4's page-level ExclusionManager.

## Future evolution

`positionMode: "fixed-on-page"` — Word's "fix position on page" mode. Image's globalY = `pageTop + yOffset`, ignoring the anchor flow. Anchor becomes a pure undo/select grouping. The schema field already exists as a placeholder; adding the branch in `applyFloatLayout` is the entire change. Ship when a concrete consumer needs it.

## Recommended ship order summary

| # | Phase | Visible to user? | Depends on | State |
|---|---|---|---|---|
| 1 | yOffset attr + structural threading | No (yOffset=0 default) | — | ✅ landed (#58) |
| 2 | Drag commits yOffset, freezes anchor | Yes — drag flicker fixed | 1 | ✅ landed (#58) |
| 3 | Image height out of paragraph | Yes — empty-anchor case fixes | 1 | ✅ landed (#58) |
| 4 | Square: per-object → page-level exclusions | No | 1 | ✅ landed (#58) |
| 5 V1 | Top-bottom: contributes side:"full" rect | No | 4 | ✅ landed (#58) |
| 5 V2 | Top-bottom: rip out FlowBlock split | No | 5 V1 | ✅ landed (#59) |
| 6 | zIndex paint/hit-test ordering | Yes — send-to-back works | 5 V2 | ✅ landed (#59) |
| Polish | Same-page re-anchor, cross-page exact-position drop | Yes | 2 | ✅ landed (#59) |

Each phase shipped independently. The discipline of resisting combination
held — every phase landed alone with its own changeset and tests.
