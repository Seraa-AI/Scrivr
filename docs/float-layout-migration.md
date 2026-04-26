# Global-Y Float Layout Migration

## What Changed

Scrivr's float layout system was rewritten from a post-pagination pass (`applyFloatLayout`) to a pre-pagination constraint solver. The new system resolves float positions and reflows text in continuous Y space before pagination sees the flows. Net result: -397 lines of code, one bug fixed for free, and a cleaner architecture.

---

## The Old System

The old pipeline ran four passes after pagination:

```
Stage 1: buildBlockFlow      — measure all blocks (unconstrained, full width)
Stage 2: paginateFlow        — assign blocks to pages
Stage 3: applyFloatLayout    — float positions + text reflow (4 sub-passes)
Stage 4: buildFragments      — fragment index for tile renderer
```

`applyFloatLayout` had four sub-passes:

| Pass | What it did |
|------|-------------|
| Pass 2 | Walk paginated pages, find float anchors, compute float X/Y in page-local coordinates, build ExclusionManager |
| Pass 3 | For each page with exclusions, re-layout blocks whose lines overlap a float. Cascade yDelta to downstream blocks. Split blocks that overflow past pageBottom. |
| Pass 3b | Propagate overflow to pages that Pass 3 skipped (no exclusions but blocks pushed down by Pass 3 overflow) |
| Pass 4 | Reconcile float Y values after Pass 3 shifted anchor blocks |

This worked but had problems:

- ~550 lines of complex mutation logic
- Pass 3b overflow cascade could duplicate paragraph content across pages
- Pass 4 was a patch for Pass 3 side effects
- Page-local coordinates made the constraint provider page-scoped, preventing future features like cross-page selection

---

## The New System

```
Stage 1:    buildBlockFlow          — measure all blocks (unconstrained)
Stage 1.5:  assignGlobalY           — stamp continuous Y on each FlowBlock
Stage 1.75: constraint loop         — resolve floats + reflow text (pre-pagination)
Stage 2:    paginateFlow            — assign blocks to pages
Stage 3:    projectFloatsOntoPages  — derive page-local coords from globalY
Stage 4:    buildFragments          — fragment index
```

### Stage 1.5: assignGlobalY

Walks all FlowBlocks top to bottom, applying CSS-style margin collapsing, and stamps a `globalY` value on each. This is the block's position in a continuous vertical strip with no page boundaries.

```
Block 0: globalY = 72 (margins.top)
Block 1: globalY = 72 + block0.height + max(block0.spaceAfter, block1.spaceBefore)
Block 2: globalY = block1.globalY + block1.height + collapsed margin
...
```

Page break nodes get a globalY marker but contribute zero height.

### Stage 1.75: Constraint Loop

Three steps run in sequence:

**Step 1 — Estimate page boundaries.** Walk the unconstrained flows and accumulate heights. When accumulated height exceeds page content height, mark a page break barrier at that globalY. These barriers tell the float resolver where pagination will split.

**Step 2 — Resolve floats.** `resolveFloatsGlobalY` walks all FlowBlocks looking for zero-width float anchor spans. For each anchor, it computes the float's position in globalY space:

- X position from wrapping mode (left/right/full)
- Y position from anchor's globalY + floatOffset
- Stacking: push below any overlapping previously-placed float
- Page break barriers: if a float would span a barrier, push it past

The result is a `FloatLayout[]` with `globalY` set, and an `ExclusionManager` populated with exclusion rects in global Y (no page field).

**Step 3 — Reflow constrained blocks.** `reflowConstrainedBlocks` iterates all flows. For each flow whose lines overlap an exclusion zone, it calls `layoutBlock` with a `constraintProvider`. The constraint provider queries the ExclusionManager at each line's globalY to get the narrowed available width. The block's `lines` and `height` are updated in place.

This is a fixed-point loop (max 3 iterations). After reflow changes heights, `recomputeGlobalY` updates downstream blocks. Float positions are NOT re-resolved (pinned to prevent oscillation). The loop breaks when no block heights change.

### Stage 3: projectFloatsOntoPages

After pagination, this function projects each float from globalY to page-local coordinates:

1. Build an anchor map: walk paginated pages, find zero-width float anchor spans, record their `(page, blockY)`
2. For each float, compute `delta = float.globalY - float.anchorBlockY`, then `candidateY = anchor.blockY + delta`
3. If the float extends past pageBottom, overflow to the next page
4. Materialise empty pages for overflow floats

This replaces all 550 lines of the old `applyFloatLayout` with ~80 lines.

---

## The Debugging Journey

### Attempt 1: Naive Migration (failed)

First attempt: wire the constraint loop, delete `applyFloatLayout`, replace with `projectFloatsOntoPages`. Unit tests passed (750/750). Visual regression in the browser: text not wrapping around floats.

### Root Cause 1: Oscillation

The constraint loop re-resolved float positions on every iteration. When a float constrains its own anchor block, the reflow moves the anchor span to a different line, which moves the float, which changes the exclusion zone, which changes the reflow. Classic oscillation.

```
Iteration 0: block height = 298 (constrained)
Iteration 1: block height = 90  (unconstrained — float moved)
Iteration 2: block height = 298 (constrained — float moved back)
```

**Fix:** Resolve floats once before the loop. Pin their positions. Only reflow blocks and recompute downstream globalY inside the loop.

### Root Cause 2: Page Projection Overflow

After fixing oscillation, the constraint loop worked (browser diagnostics confirmed `h=153.6 lines=8` becoming `h=249.6 lines=13`). But visually, text appeared unconstrained.

The float at globalY=900 with height=200 was projected to page-local Y=900. Since 900+200=1100 > pageBottom=1051, `projectFloatsOntoPages` pushed the float to page 2. But the constraint loop had already constrained text at globalY=910 (page 1) for a float at globalY=900. The text was narrow on page 1 with no float beside it.

**Fix:** Add page-boundary barriers. Before the constraint loop, walk the unconstrained flows to estimate where pagination will break. Pass these barriers to `resolveFloatsGlobalY`. When a float would span a barrier, it gets pushed past it. The exclusion zone moves with the float, so only text at the float's actual globalY range gets constrained.

### The Key Insight

From the CSS spec: **a float's page membership is determined by where its anchor was before text reflowed around it.** The old system respected this because Pass 2 placed floats at pre-reflow positions. The new system needed page-boundary barriers to achieve the same effect.

---

## What Also Shipped

Four bug fixes on top of the migration:

| Fix | File | What |
|-----|------|------|
| Float clipping | TileManager.ts | `overflow: hidden` on page tile wrappers. Prevents float images from bleeding past page edges. |
| Cursor on float-only pages | CharacterMap.ts | `nearestLineOrAdjacent` searches adjacent pages when the clicked page has no text lines. |
| Orphaned narrow lines | PageLayout.ts | `clearOrphanedConstraints` reverts constrained line widths on continuation blocks where no float exists on that page. |
| Enter after float | Paragraph.ts | `cursorIsAfterFloat` adjusts the split point so float anchors land in the lower block after Enter. |

---

## Architecture Diagram

```
ProseMirror Doc
      |
      v
collectLayoutItems()         Walk doc, expand lists into flat items
      |
      v
buildBlockFlow()              Measure each item → FlowBlock (height, lines)
      |                       Position-independent. Cache via WeakMap<Node>.
      v
assignGlobalY()               Stamp continuous Y with margin collapsing
      |
      v
resolveFloatsGlobalY()        Find anchors, position floats, build exclusions
      |                       Page-break barriers prevent cross-page floats
      v
reflowConstrainedBlocks()     Re-layout blocks that overlap exclusion zones
      |                       Fixed-point loop (max 3), modifies flow.lines in place
      v
paginateFlow()                Assign flows to pages, split at page boundaries
      |                       Phase 1b: early termination from cache
      v
projectFloatsOntoPages()      Map float globalY → (page, page-local Y)
      |                       Overflow check, materialise empty pages
      v
buildFragments()              One LayoutFragment per block per page
      |                       O(log N) binary search for tile renderer
      v
DocumentLayout                Pages + floats + fragments → renderer
```

---

## Key Design Decisions

### 1. Floats are resolved once, not iteratively

Re-resolving floats inside the constraint loop causes oscillation. Float positions are computed from unconstrained flow positions and pinned. Only block heights change during the loop.

### 2. Page boundaries are estimated, not exact

Before pagination runs, we walk the unconstrained flows to predict where page breaks will occur. These estimates are passed as barriers to `resolveFloatsGlobalY`. The estimates are accurate enough because the anchor blocks (zero-height) don't change during constraint reflow.

### 3. Pagination is read-only for constraints

`paginateFlow` receives flows with final constrained heights. It does not re-layout anything. It only assigns blocks to pages and splits blocks at page boundaries. This is the "pagination is projection" principle.

### 4. The ExclusionManager works in two modes

When called with a `page` parameter, it filters rects by page (legacy mode). When called with `page: undefined`, it matches in global-Y space (new mode). Both use the same range-overlap semantics.

---

## What's Deferred

| Item | Why deferred |
|------|-------------|
| Phase 1b using `placedGlobalY` | Perf optimization, not correctness. Current (targetY, page) check works. |
| Orphaned narrow lines (globalY-based) | Current page-membership check works for most cases. GlobalY overlap would be more precise. |
| Float offset spacing regression | Negative `floatOffset.y` creates dead space in top-bottom mode. Needs exclusion zone to ignore Y offset for break floats. |
| Torture rig / fuzz testing | Test strategy designed, not yet implemented. Priority: constraint consistency, fuzz runner, idempotence. |

---

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `PageLayout.ts` | Replace applyFloatLayout, add constraint loop + projectFloatsOntoPages + clearOrphanedConstraints | -556, +159 |
| `CharacterMap.ts` | Add nearestLineOrAdjacent for float-only page cursor | +16 |
| `CharacterMap.test.ts` | Update tests for cross-page fallback behavior | +5, -4 |
| `TileManager.ts` | Add overflow:hidden to page wrappers | +1 |
| `Paragraph.ts` | Add cursorIsAfterFloat + split point adjustment | +18, +4 |
| `ExclusionManager.ts` | Add hasExclusionsInRange for global-Y mode | +6 |
| `globalY.test.ts` | 20 invariant tests for the constraint solver | +392 |
| `CLAUDE.md` | TDD convention, updated pipeline stage names | +3, -2 |
