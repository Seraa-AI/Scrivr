# Float Layout v2 — Full Specification

> **Superseded design note.** This document records the retired
> CSS-float-era solver design. The authoritative model is now
> `docs/anchored-objects/00-model.md` through `05-future.md`.
> In particular, layout no longer reads `floatOffset`, and square
> wrapping should be understood as exclusion rectangles producing
> available line segments, not as a float mode choosing one side.

> **Status:** Draft spec. The POC lives on branch `fix/float-global-layout` (PR #51).
> This document captures everything learned from the POC so the next implementation
> can start from a clear picture.

---

## 1. Problem Statement

Scrivr's float layout positions images (wrap-left, wrap-right, top-bottom, behind, front) relative to their anchor paragraph and reflows surrounding text to avoid overlap. The original system (`applyFloatLayout`) ran four post-pagination passes that mutated already-paginated blocks. This caused:

| Problem | Impact |
|---------|--------|
| Paragraph duplication across pages | Pass 3/3b overflow cascade could clone block content when a constrained block split at a page boundary |
| ~550 lines of complex mutation logic | Passes 2/3/3b/4 each walked pages and mutated block positions, heights, and line arrays in place |
| Page-local coordinate lock-in | Constraints were resolved per-page, blocking future cross-page features (selection, drag) |
| Pass 4 was a patch for Pass 3 | After Pass 3 shifted anchor blocks, Pass 4 reconciled float Y values — a symptom of the wrong abstraction |

### The old pipeline

```
Stage 1: buildBlockFlow      — measure all blocks (unconstrained, full width)
Stage 2: paginateFlow        — assign blocks to pages
Stage 3: applyFloatLayout    — float positions + text reflow (4 sub-passes)
  ├── Pass 2: Walk pages, find anchors, compute page-local float X/Y, build ExclusionManager
  ├── Pass 3: Re-layout constrained blocks, cascade yDelta, split overflows
  ├── Pass 3b: Propagate overflow to pages with no exclusions but shifted blocks
  └── Pass 4: Reconcile float Y after Pass 3 shifted anchors
Stage 4: buildFragments      — fragment index for tile renderer
```

---

## 2. Solution: A Constraint-Based Layout Engine

This is not "float positioning." It is a 2-phase constraint solver — closer to a browser layout engine than a document editor's ad-hoc pass system. That framing matters because the open bugs and hardening items are not edge cases — they are missing invariants in a constraint system.

### 2.1 Two Coordinate Spaces (Enforced Separation)

The system operates in two distinct spaces. The POC mixed them, causing the offset spacing regression (6.1) and mental confusion throughout. v2 enforces strict separation:

| Space | Owner | Used by | Feeds back into layout? |
|-------|-------|---------|-------------------------|
| **Layout space** (structural) | Constraint solver | `ExclusionManager`, `reflowConstrainedBlocks`, `paginateFlow` | N/A — this IS layout |
| **Visual space** (rendering) | Renderer | `PageRenderer`, `TileManager` | **Never.** Visual space is derived and read-only. |

**The rule:**

> Layout space is immutable and constraint-driven.
> Visual space is derived from layout space and never feeds back into layout.

This means `floatOffset.y` is a visual-space concept. It shifts where the image is painted. It does NOT shift the exclusion rect, the constraint zone, or the anchor's globalY.

### 2.2 Input Normalization (Non-Optional)

The solver assumes inputs are bounded and valid. User-authored documents can contain anything — enormous images, dozens of floats on one paragraph, extreme offsets. If unchecked, these blow up stacking (O(n^2)), cause infinite push chains, or produce layouts wider than the page.

**All constraints entering the solver MUST be normalized into a valid, bounded domain.**

This happens at Stage 1.6, before float resolution:

```ts
function normalizeConstraints(flows, pageConfig): NormalizedFloatInput[]
```

**Rules:**

| Rule | What | Why |
|------|------|-----|
| **Size clamping** | `width = clamp(width, 1, contentWidth)`, `height = clamp(height, 1, pageHeight * 2)` | Prevents infinite stacking and layout explosions |
| **Offset clamping** | `offsetY = clamp(offsetY, -pageHeight, pageHeight)`, `offsetX = clamp(offsetX, -contentWidth, contentWidth)` | Prevents floats teleporting far from anchor |
| **Float count guard** | If `floatsPerAnchorBlock > MAX_FLOATS_PER_BLOCK` (e.g. 8), excess floats degrade to `top-bottom` | Prevents O(n^2) stacking resolution |
| **Invalid mode fallback** | Unknown or conflicting `wrappingMode` → `top-bottom` | Top-bottom is the safe mode — no side constraints, just vertical displacement |
| **Zero-dimension guard** | `width < 1` or `height < 1` → skip float entirely (no exclusion, no render) | Prevents zero-area exclusion rects that confuse the solver |

`top-bottom` is the universal safe mode because it creates no side constraints — just a vertical gap. Any float that can't be safely resolved degrades to top-bottom rather than being dropped.

### 2.3 Three-Phase Solver

The pipeline is a 3-phase solver with a read-only projection:

**Phase 0 — Input Normalization**
- Clamp sizes, offsets, counts
- Degrade invalid inputs to safe modes
- Guarantee: all inputs to Phase A are bounded and valid

**Phase A — Constraint Declaration**
- Floats define exclusion regions (spatial constraints)
- Page break barriers define forbidden Y ranges (pagination constraints)

**Phase B — Constraint Satisfaction**
- Blocks adapt to constraints via fixed-point reflow
- Heights change monotonically (see 2.4)
- Float positions are pinned (no re-resolution)

**Phase C — Projection (read-only)**
- Pagination assigns blocks to pages
- Float globalY maps to page-local coordinates
- No mutation, no reflow

### 2.4 Constraint Priority

When multiple constraints affect the same float position, they are applied in strict priority order. Higher-priority constraints override lower ones deterministically:

| Priority | Constraint | Effect |
|----------|------------|--------|
| 1 (highest) | **Anchor position** | Base reference — `layoutY = anchor.globalY` |
| 2 | **Barriers** | Page structure — push float past page boundary |
| 3 | **Float stacking** | Avoid overlap with prior floats |
| 4 | **Wrapping mode** | Determines X position and exclusion side |
| 5 (lowest) | **Offset** | Visual-only shift — never overrides layout position |

This means: a barrier push always wins over stacking preference. Stacking always wins over wrapping mode (a left-float may be pushed down even if there's room to the right). Offset never influences constraint resolution.

### 2.5 System Invariants

These must hold at all times. Violations indicate bugs in the solver, not edge cases.

| Invariant | Why |
|-----------|-----|
| **Inputs are bounded** | All float dimensions, offsets, and counts are clamped before entering the solver. No unbounded input reaches constraint resolution. |
| **Constraints are monotonic** | Exclusion zones only grow or stay fixed. They never shrink during the constraint loop. |
| **Reflow is monotonic in height** | `newHeight >= oldHeight` for every block in every iteration. If a block shrinks, the constraint loop can oscillate. This is the formal guarantee that prevents the 298→90→298 cycle. |
| **Layout terminates in finite steps** | The constraint loop has a hard cap (`MAX_ITERATIONS = 5`). If exceeded, remaining float constraints are dropped and blocks reflow at full width. The system always produces output. |
| **Layout space never reads from visual space** | `floatOffset`, rendered positions, and page-local coordinates never feed back into constraint resolution. |
| **Barriers are frozen** | Computed once from unconstrained flow heights, then frozen for the entire constraint loop. Floats respect barriers; barriers do not react to floats. |
| **Float positions are pinned** | Resolved once before the loop from unconstrained positions. Never re-resolved during constraint satisfaction. |
| **Constraint priority is deterministic** | When constraints conflict, the priority order in 2.4 determines the winner. Same input always produces same output. |
| **Pagination is projection** | `paginateFlow` receives final constrained heights. It assigns blocks to pages. It does not re-layout anything. |

### 2.6 The Pipeline

```
Stage 1:    buildBlockFlow          — measure all blocks (unconstrained)
Stage 1.5:  assignGlobalY           — stamp continuous Y with CSS-style margin collapsing

        ┌── Phase 0: Input Normalization ─────────────────────────────────┐
        │  Stage 1.6: normalizeConstraints — clamp sizes, offsets,        │
        │             counts. Degrade invalid floats to top-bottom.       │
        │  Guarantee: all inputs to Phase A are bounded and valid.        │
        └─────────────────────────────────────────────────────────────────┘

        ┌── Phase A: Constraint Declaration ──────────────────────────────┐
        │  Step 1: Compute barriers from unconstrained flow heights       │
        │  Step 2: resolveFloatsGlobalY — position floats in layout       │
        │          space. Per float: anchor → barrier push → stacking.    │
        │          Build exclusion rects (all in layout space).           │
        │  *** Freeze barriers and float positions ***                    │
        └─────────────────────────────────────────────────────────────────┘

        ┌── Phase B: Constraint Satisfaction (fixed-point, max 5 iter) ──┐
        │  Step 3: reflowConstrainedBlocks — re-layout overlapping       │
        │          blocks with narrowed width                             │
        │  Step 4: recomputeGlobalY — update downstream positions        │
        │  Assert: newHeight >= oldHeight (monotonic reflow)              │
        │  Break when no heights change                                   │
        │  If iterations exhausted → degradeLayout (drop constraints)     │
        └─────────────────────────────────────────────────────────────────┘

Stage 2:    paginateFlow            — assign blocks to pages (read-only)
Stage 3:    projectFloatsOntoPages  — map layout-space globalY → visual-space page-local coords
Stage 4:    buildFragments          — fragment index for tile renderer
```

### 2.7 Net Result (from POC)

- **-397 lines** of code (deleted ~550 lines of applyFloatLayout, added ~153 for new functions)
- Paragraph duplication bug fixed for free
- ExclusionManager works in both page-scoped (legacy) and global-Y (new) modes
- Constraint loop converges in 1-2 iterations for typical documents
- Architecture is extensible beyond floats (tables, columns, margin notes can declare constraints using the same solver)

---

## 3. Function Specifications

### 3.1 `assignGlobalY(flows, startY)`

Walks all FlowBlocks top-to-bottom, applies CSS-style margin collapsing between adjacent blocks, and stamps a `globalY` field on each.

**Rules:**
- First block: `globalY = startY` (typically `margins.top`)
- Subsequent blocks: `globalY = prev.globalY + prev.height + collapseMargins(prev.spaceAfter, curr.spaceBefore)`
- Page break nodes: receive a `globalY` marker but contribute zero height
- `collapseMargins(a, b)` returns `Math.max(a, b)` (CSS collapsing)

**Invariants:**
- Monotonic: `block[i].globalY <= block[i+1].globalY` for all i
- No overlap: `block[i].globalY + block[i].height <= block[i+1].globalY`
- Idempotent: calling twice produces the same result

### 3.2 `normalizeConstraints(flows, pageConfig)` — Phase 0

Walks all float anchors and clamps their attributes into the solver's valid domain. Returns normalized float inputs. Runs at Stage 1.6, after `assignGlobalY` and before `resolveFloatsGlobalY`.

**Clamping rules:**

```ts
const MAX_FLOATS_PER_BLOCK = 8;
const MAX_PUSH_DISTANCE = pageHeight * 3;  // safety cap for stacking chains

width  = clamp(width, 1, contentWidth);
height = clamp(height, 1, pageHeight * 2);
offsetY = clamp(offsetY, -pageHeight, pageHeight);
offsetX = clamp(offsetX, -contentWidth, contentWidth);
```

**Degradation rules:**
- Unknown or missing `wrappingMode` → `top-bottom`
- `width < 1` or `height < 1` → skip float entirely (no exclusion, no render)
- If a single anchor block has more than `MAX_FLOATS_PER_BLOCK` floats, excess floats (by doc order) degrade to `top-bottom`
- If stacking pushes a float more than `MAX_PUSH_DISTANCE` from its anchor → convert to `top-bottom`

### 3.3 `resolveFloatsGlobalY(flows, margins, pageWidth, contentWidth, pageBreakYs)` — Phase A

Finds zero-width float anchor spans in flows, positions each float in layout space, builds exclusion rects. This is Phase A of the constraint solver.

**Returns:** `{ floats: FloatLayout[], exclusionMgr: ExclusionManager } | null`
Returns `null` when no float anchors exist (fast path — skip entire constraint loop).

**FloatLayout type (v2 — layout/visual split):**

```ts
type FloatLayout = {
  docPos: number;
  mode: WrappingMode;
  width: number;
  height: number;

  // LAYOUT SPACE — used by constraint solver + ExclusionManager
  layoutY: number;         // ALWAYS = anchor.globalY (never includes offset)
  layoutX: number;         // content-area X + floatOffset.x (X offset IS structural)
  anchorGlobalY: number;   // anchor block's globalY at resolution time

  // VISUAL SPACE — used by renderer only, derived after projection
  renderY: number;         // layoutY + floatOffset.y (applied during projectFloatsOntoPages)
  renderX: number;         // layoutX (same — X offset already included)
  page: number;            // assigned by projectFloatsOntoPages
};
```

The exclusion rect is built from `layoutY` / `layoutX`. The renderer reads `renderY` / `renderX`. Visual space never feeds back into layout.

**Per-float positioning:**

1. **Collect anchor:** Walk flows → lines → spans, find `span.kind === "object" && span.width === 0` with `wrappingMode` set
2. **Read attributes:** `wrappingMode`, `floatOffset.x`, `floatOffset.y`, node width/height
3. **X position (layout space — includes X offset):**
   - `square-left`: `contentX + offsetX`
   - `square-right`: `contentRight - width + offsetX`
   - `top-bottom`: centered or full-width (implementation choice)
   - `behind` / `front`: same X logic, no exclusion rect
   - Clamped to `[contentX, contentRight - width]`
4. **Y position (layout space — NO Y offset):** `layoutY = anchor.globalY`
5. **Stacking:** While any previously-placed same-side float overlaps horizontally AND vertically, push `layoutY` below it (`overlap.layoutY + overlap.height + FLOAT_MARGIN`)
6. **Page break barriers:** If `layoutY` and `layoutY + height` straddle a barrier Y, push `layoutY = barrierY` (float goes entirely to next page). **Then** re-check stacking against ALL prior floats (not just same-side) — barrier push can create new overlaps.
7. **Exclusion rect:** Built from `layoutY` with `FLOAT_MARGIN_GLOBAL = 8px` padding. Side is `"left"` / `"right"` / `"full"` based on wrapping mode. No `page` field (global-Y mode).

**Key invariant:** Float positions are resolved ONCE from unconstrained flow positions and pinned. They are never re-resolved during the constraint loop. Barriers are frozen before this function runs.

### 3.4 `reflowConstrainedBlocks(flows, exclusionMgr, margins, contentWidth, measurer, fontConfig, ...)` — Phase B

For each flow whose lines overlap an exclusion zone, re-layout the block with a `constraintProvider` that narrows the available width.

**Returns:** `{ changed: boolean, firstChangedIndex: number }`

**Algorithm:**
1. For each flow (skip page breaks, empty blocks, blocks without `globalY`):
   - Walk lines from `flow.globalY`, test each line's Y range against `exclusionMgr.hasExclusionsInRange(lineY, lineY + lineHeight)`
   - If no line overlaps any exclusion → skip
2. Build a `constraintProvider: (absoluteLineY) => LineConstraint | null` that calls `exclusionMgr.getConstraint(undefined, absoluteLineY, 1, blockContentX, blockAvailWidth)`
3. Call `layoutBlock(...)` with the constraint provider
4. If `reflowed.height !== flow.height` → mark changed, update `firstChangedIndex`
5. Replace `flow.lines` and `flow.height` in place

**After the loop body:** caller runs `recomputeGlobalY(flows, firstChangedIndex + 1)` to update downstream block positions.

### 3.5 `recomputeGlobalY(flows, startIndex)`

Re-stamps `globalY` on flows from `startIndex` onward using the same margin-collapsing logic as `assignGlobalY`. Only called after `reflowConstrainedBlocks` changes block heights.

### 3.6 `projectFloatsOntoPages(paginatedLayout, resolvedFloats, pageConfig)` — Phase C

After pagination, maps each float from global-Y to page-local coordinates.

**Algorithm:**
1. Build anchor map: walk paginated pages → blocks → lines → spans, collect `docPos → { page, pageLocalY }` for float anchors. `pageLocalY` is the block's Y within the page (page-local coordinates, set by `paginateFlow`).
2. For each float:
   - `delta = float.globalY - float.anchorGlobalY` (both in global-Y space)
   - `candidateY = anchor.pageLocalY + delta` (project the global-Y delta into page-local space)
   - If `candidateY + height > pageBottom` → overflow to `anchorPage + 1`, place at `contentTop`
   - Otherwise: `page = anchor.page, y = candidateY`
3. Materialise empty `LayoutPage` entries for floats that land on non-existent pages
4. Run `clearOrphanedConstraints` on continuation blocks

### 3.7 `clearOrphanedConstraints(pages, floats)`

When a constrained block splits across pages during pagination, overflow lines may carry stale `constraintX` / `effectiveWidth` from the pre-pagination reflow. Lines on continuation blocks that don't overlap any float on their page get cleared.

**Algorithm:**
- No wrapping floats on page → clear ALL continuation block constraints
- Has wrapping floats → per-line overlap check, clear only non-overlapping lines

### 3.8 `ExclusionManager` (dual-mode)

Manages exclusion rects for both legacy page-scoped and new global-Y usage.

| Method | Purpose |
|--------|---------|
| `addRect(rect)` | Push an exclusion rect (with or without `page` field) |
| `getConstraint(page, absoluteY, lineHeight, contentX, contentWidth)` | Returns `{ x, width, skipToY? }` or null. `page: undefined` = global-Y mode |
| `hasExclusionsInRange(yStart, yEnd)` | Boolean overlap test in global-Y space |
| `getNextFreeY(page, absoluteY)` | Skip past full-width (top-bottom) exclusions |
| `hasExclusionsInPage(page)` | Boolean check for any wrapping exclusion on a page |

For `"full"` (top-bottom) side, `getConstraint` returns `{ x: 0, width: 0, skipToY: rect.bottom }` — tells the line breaker to skip entirely past the float.

---

## 4. Key Design Decisions

### 4.1 Floats resolved once, not iteratively

Re-resolving floats inside the constraint loop causes oscillation:
```
Iter 0: block constrained → height 298px (13 lines)
Iter 1: float moves (anchor shifted) → unconstrained → height 90px (5 lines)
Iter 2: float moves back → constrained → height 298px
```
Fix: resolve float positions from UNCONSTRAINED flow positions. Pin them. The constraint loop only changes block heights and downstream globalY values.

### 4.2 Barriers are frozen, not reactive

Barriers are **constraints derived from pagination rules**, not estimates that get refined. They are computed once from unconstrained flow heights and frozen for the entire constraint loop.

The temptation is: "heights changed after reflow, so recompute barriers and re-check floats." This creates a hidden feedback loop:

```
barriers → float placement → reflow → height changes → barriers (!!!)
```

Instead:
- **Step 1:** Compute barriers from unconstrained flow
- **Step 2:** Resolve floats against those barriers
- **Step 3:** Freeze barriers for the entire constraint loop
- **After convergence:** `paginateFlow` handles the actual page breaks (which may differ slightly from barrier estimates). `projectFloatsOntoPages` handles overflow.

Floats respect barriers. Barriers do not react to floats.

### 4.3 Reflow must be monotonic in height

The constraint loop's convergence depends on block heights only increasing or staying equal:

```
newHeight >= oldHeight   // MUST hold for every block, every iteration
```

When a float constrains a block, lines wrap tighter → more lines → taller block. The block never gets shorter because constraints only narrow width (never widen it — exclusion zones are pinned). If this invariant is ever violated, the system can oscillate.

This should be enforced with a runtime assertion in debug mode.

### 4.4 Layout always terminates (degradation strategy)

The constraint loop has a hard cap of `MAX_ITERATIONS = 5`. If convergence is not reached:

```ts
if (iterations >= MAX_ITERATIONS) {
  degradeLayout(flows, exclusionMgr);
}
```

**`degradeLayout` is not vague — it has a defined behavior:**

1. Drop all remaining float constraints (clear the ExclusionManager)
2. Reflow all constrained blocks at full width
3. Float positions are preserved (they're already pinned) — only the text wrapping is removed

The result: floats render at their correct positions, but text doesn't wrap around them. This is visually imperfect but geometrically valid — no overlaps, no infinite loops, no crashes.

**Additional degradation rules (applied during Phase A, not Phase B):**

| Condition | Action |
|-----------|--------|
| Float pushed more than `MAX_PUSH_DISTANCE` from anchor | Convert to `top-bottom` |
| Float-on-float overlap cannot be resolved after all stacking | Stack vertically ignoring side preference |
| Float extends below document | Clamp to last page bottom |

**The principle:** A good layout engine does not try to be correct under pathological input. It tries to be **predictable** (same bad input → same layout), **stable** (small changes → small effects), **bounded** (no infinite loops), and **recoverable** (safe fallback).

### 4.5 Pagination is read-only for constraints

`paginateFlow` receives flows with final constrained heights. It assigns blocks to pages and splits at boundaries. It does NOT re-layout anything. This is the "pagination is projection" principle.

### 4.6 Float page membership from pre-reflow anchor position

CSS spec rule: a float's page is determined by where its anchor was BEFORE text reflowed around it. The constraint loop grows blocks (more lines = taller), but that growth must not change which page a float belongs to. `projectFloatsOntoPages` uses the anchor's paginated position, which reflects pre-reflow height.

### 4.7 `updateFloatAnchors` — defined but not called

This function re-derives float globalY from shifted anchors. It exists for future use (non-zero-height anchors like captioned floats), but calling it inside the constraint loop would re-introduce oscillation. Currently all float anchors are zero-height, so anchor positions don't shift during reflow.

---

## 5. What the POC Got Right

These are validated and should be kept as-is in v2:

| What | Evidence |
|------|----------|
| `assignGlobalY` with CSS margin collapsing | 5 unit tests pass, correct stacking in browser |
| `resolveFloatsGlobalY` with stacking + barriers | 4 unit tests pass, visual verification in browser |
| `reflowConstrainedBlocks` fixed-point loop | Converges in 1-2 iterations, browser shows correct text wrapping |
| `projectFloatsOntoPages` with overflow | Floats correctly land on next page when they don't fit |
| `ExclusionManager` dual-mode (page + globalY) | Backwards compatible, 3 unit tests |
| `clearOrphanedConstraints` on continuations | Continuation blocks revert to full width when no float is on their page |
| Pipeline wiring in `runFlowPipeline` | All 6 stages connected, 750/750 tests pass |

### Bug fixes that shipped with the POC

| Fix | File | Status |
|-----|------|--------|
| Float clipping | `TileManager.ts:731` — `overflow: hidden` on page wrappers | Verified working |
| Cursor on float-only pages | `CharacterMap.ts:381-392` — `nearestLineOrAdjacent` | Verified working |
| Orphaned narrow lines | `PageLayout.ts:1311-1346` — `clearOrphanedConstraints` | Verified working |
| Enter after float | `Paragraph.ts:36-61` — `cursorIsAfterFloat` + split adjustment | Verified working |

---

## 6. What the POC Got Wrong (Open Bugs)

### 6.1 Coordinate space violation — visual offset leaking into layout space

**Symptom:** Top-bottom float with negative `floatOffset.y` (e.g. `{x: -48, y: -45}`) creates ~45px blank gap above and below the image.

**Root cause:** The POC computed `float.globalY = anchor.globalY + offsetY`, then built the exclusion rect from that mixed-space value. This violates the coordinate space separation rule (2.1): `floatOffset.y` is a visual-space concept that leaked into layout space.

**Fix:** Already specified by the `FloatLayout` type split in 3.2. `layoutY = anchor.globalY` (always). `renderY = layoutY + offsetY` (applied during projection). ExclusionManager uses `layoutY`. Dead space eliminated because the exclusion zone starts exactly at the anchor, not 45px above it.

This is not a per-mode fix. It's a universal rule enforced by the type system: `layoutY` and `layoutX` are the only fields the solver reads. `renderY` and `renderX` are the only fields the renderer reads.

### 6.2 Doc model vs layout model mismatch — PARTIALLY FIXED

**Symptom:** With a float image in top-bottom mode, text typed after the image appears visually below it. Pressing Enter splits the paragraph, but text ends up above the image.

**POC fix:** `cursorIsAfterFloat` in `Paragraph.ts` adjusts the split point so the float anchor lands in the lower block. This works for the simple case (cursor immediately after float).

**The deeper issue:** This is not a UI bug — it's a model mismatch. Float anchors are inline nodes in the ProseMirror doc tree (doc-order position), but the layout engine renders them at displaced visual positions (layout-space position). Paragraph splits respect doc order, not layout order. The POC fix patches one case but doesn't resolve the fundamental tension.

**Fix direction for v2:** Short-term: make the split logic float-aware at a deeper level — after any split in a paragraph containing a float, verify that the float anchor ends up in the block that corresponds to its layout-space position. Long-term: float anchors should be structural nodes (not inline hacks) so doc order matches layout intent. This is a larger model change that would also simplify 6.3.

### 6.3 Float-only page cursor jumps to position 0 — PARTIALLY FIXED

**Symptom:** Click on a page with only a float (no text lines) → `posAtCoords` returns 0 → cursor jumps to document start.

**POC fix:** `nearestLineOrAdjacent` in `CharacterMap.ts` searches adjacent pages when the clicked page has no text lines.

**Remaining issue:** The fix finds the nearest line on an adjacent page, but the user's click was on the float-only page. The cursor lands on the adjacent page's text, not near the float. For a better UX, clicking near a float should select the float's anchor position.

**Fix direction for v2:** Hit-test floats FIRST, then fall back to text lines. If click coordinates fall within a float's bounding box, return the float's `docPos`. Only search text lines (and adjacent pages) if no float was hit. This inverts the current order (text first → float never).

**Interaction with 6.2 (Enter after float):** If the user clicks a float-only page and the cursor resolves to the float anchor's `docPos`, then presses Enter, `cursorIsAfterFloat` must handle this correctly. The cursor would be AT the float anchor position (not after it — `nodeBefore` may be text, not the float). The v2 fixes for 6.2 and 6.3 should be tested together: click float-only page → cursor at anchor → Enter → verify split doesn't orphan the float.

### 6.4 Cross-page selection highlight — OPEN (pre-existing)

**Symptom:** Selection highlight renders on page 1 but doesn't continue onto page 2 when selection spans pages.

**Not caused by the float migration** — this is a pre-existing bug in `OverlayRenderer` / `TileManager.paintOverlay`. Including here because the migration's move to global-Y coordinates creates a path to fix it (selection ranges can now be resolved in continuous space).

---

## 7. Hardening Items (Robustness, Not Bugs)

These are edge cases identified during review. Not blocking for v2 but should be addressed before the float system is considered production-ready.

### 7.1 Barrier accuracy vs frozen barriers

Per 4.2, barriers are frozen for the constraint loop. But barrier estimates come from unconstrained flow heights, and the constraint loop changes heights. The actual page breaks (from `paginateFlow`) may differ from the barrier estimates.

**Why this is acceptable:** Barriers exist to prevent floats from straddling page boundaries. If a barrier estimate is slightly off, the worst case is a float placed just above or below where the actual page break lands. `projectFloatsOntoPages` handles overflow — if a float extends past the actual page bottom, it gets pushed to the next page. The projection stage is the safety net.

**When it becomes a problem:** If barrier inaccuracy causes a float to be placed on the wrong side of a page break, the exclusion zone constrains text on the wrong page. This is detectable: after `paginateFlow`, check if any float's `layoutY` range straddles an actual page boundary. If so, the barrier was too inaccurate. In practice this requires extreme height growth (a block doubling in height during reflow) which is rare.

**No post-convergence barrier recomputation.** That creates the hidden feedback loop described in 4.2. The correct fix is better barrier estimation upfront (e.g., conservative estimates that slightly over-predict page breaks).

### 7.2 Float stacking must happen in final position space

In the POC, stacking runs before barrier pushes. A barrier push can move float B below float A, creating a new overlap that stacking already "resolved."

**Fix:** In `resolveFloatsGlobalY`, for each float: place at `layoutY`, apply barrier adjustment, THEN resolve stacking against ALL prior floats. This is a mandatory ordering, not a post-hoc patch:

```
for each float:
  layoutY = anchor.globalY
  if straddles barrier → push past barrier
  while overlaps any prior float → push below it
  freeze position
```

### 7.3 Non-zero-height anchor support + anchor index tracking

`updateFloatAnchors` is defined but not called. Currently safe because all float anchors are zero-height spans. If we add captioned floats or float groups with non-zero anchor height, the constraint loop needs to call `updateFloatAnchors` after `recomputeGlobalY` — without re-resolving float positions (to avoid oscillation).

**Future-proofing:** Store `float.anchorIndex` (index into `flows[]`) at resolution time. After `recomputeGlobalY`, update `float.layoutY = flows[anchorIndex].globalY`. This keeps the float's layout position in sync with its anchor without re-running stacking or barrier logic. Only the Y position shifts — X, exclusion width, and side are unchanged.

### 7.4 Streaming + partial float resolution

Partial layout + constraints = invalid system. When `maxBlocks` cutoff stops layout mid-document, floats are resolved from incomplete flows. Downstream anchors don't exist yet, so stacking and exclusion zones are incomplete. On resume, all positions could shift — violating the stability invariant.

**Fix:** Disable float constraint resolution in partial runs. Floats in partial layouts render at their anchor positions without exclusion zones. On the final (complete) run, the full constraint solver runs. This is simpler and correct — partial layout is a streaming UX optimization, not a layout guarantee.

### 7.5 X coordinate space consistency

`ExclusionManager.getConstraint` receives `blockContentX = margins.left + indentLeft`. Exclusion rects are in absolute content coordinates. If the exclusion was placed at absolute X but the block queries at indented X, constraints could over- or under-constrain.

**The rule:** All X coordinates must be resolved in the same coordinate space. The recommended approach: floats are placed relative to the **page content area** (absolute), and `getConstraint` translates the result into the block's local coordinate space. This is what the POC does — verify it's correct with a test.

**Fix:** Test: nested list (2 levels deep) with float inside a list item. Assert that constraint width accounts for the indent correctly and text wraps at the right column.

### 7.6 Early termination + floats guard

Phase 1b early termination in `paginateFlow` copies blocks from `previousLayout`. If the previous layout had different float positions, the copied blocks may have stale constraint data. Need a test that proves early termination + floats produces correct results.

---

## 8. Test Strategy

### 8.1 What exists (from POC)

20 unit tests in `globalY.test.ts` covering:
- `assignGlobalY` — 5 tests (single block, stacking, margin collapsing, page breaks, cumulative)
- `recomputeGlobalY` — 2 tests (downstream update, no-op boundary)
- `ExclusionManager` — 3 tests (global-Y mode, page filter, range detection)
- `resolveFloatsGlobalY` — 4 tests (null return, single float, stacking, barriers)
- Invariants — 4 tests (monotonic Y, no overlap, downward gravity, idempotence)
- `reflowConstrainedBlocks` — 1 test (no-change fast path)

### 8.2 What's missing

#### Reusable invariant harness: `assertLayoutInvariants(layout: DocumentLayout)`

Run on every test's output. Checks:
1. **Monotonic Y** — no line has globalY less than its predecessor
2. **No line overlap** — `prev.y + prev.height <= curr.y`
3. **No float overlap** — no two wrapping floats share space on the same page
4. **Float downward gravity** — `float.y >= anchorBlockY` (page-local)
5. **Pagination is projection** — lines on a page fall within `[contentTop, contentBottom]`

#### Fuzz runner

Random document generator: 1-20 paragraphs, 30% float probability, random modes/sizes. Run `assertLayoutInvariants` + convergence check on 500 generated docs.

#### Idempotence test

`runPipeline(doc)` must produce identical output to `runPipeline(doc)` with the same inputs. If this fails, there's hidden state mutation.

#### Adversarial float cases

| Case | What it tests |
|------|---------------|
| Float exactly at line boundary (y=900, line.y=900) | Wrapping applies |
| Float touching but not overlapping (float.bottom=900, line.top=900) | NO wrapping |
| Float 1px overlap (float.bottom=901, line.top=900) | Wrapping applies |
| Dense float stack: 10 floats alternating left/right every 10px | Stacking correctness |
| Float taller than page | Push + no infinite loop |
| Float + page boundary + reflow combined | Barrier correctness |
| Two floats (left + right) in same paragraph inside a bullet list | Indent + exclusion coordinate space |
| Float anchor near page bottom + hard pageBreak after | Barrier logic + anchor consistency |
| Paragraph spans 2 pages, float anchored in middle | `clearOrphanedConstraints` with globalY overlap |

#### Oscillation detector

Run pipeline 5 times, hash each result. If 5 unique hashes → oscillation. If repeated hash → stable or converged.

**Hash surface:** Hash only deterministic geometry tuples in document order, not object identity or references. Specifically: `(block.globalY, block.height, block.lines.length)` for each flow block, plus `(float.globalY, float.page, float.x, float.height)` for each float. Exclude `runId`, object references, and any generated IDs. This avoids false negatives from non-deterministic object ordering or identity changes between runs.

#### Cache corruption test

`runPipeline(doc, { measureCache: undefined })` must equal `runPipeline(doc, { measureCache: new WeakMap() })`.

#### Monotonic height assertion

Add a debug-mode assertion inside `reflowConstrainedBlocks`: after each block reflow, assert `newHeight >= oldHeight`. If this fires, the constraint system can oscillate and the invariant from 2.3 is violated.

#### Constraint stability under mutation

Round-trip test that proves no hidden state leaks:

```
1. result_A = layout(doc)
2. insert text near float → layout(doc')
3. delete that text → layout(doc)
4. result_B = layout(doc)
5. assert result_A === result_B (same hash surface as oscillation detector)
```

If this fails, the solver has hidden mutable state that survives across runs.

#### Degenerate layout tests (break tests)

These are not realistic — they exist to prove the system doesn't crash, loop, or produce invalid geometry under pathological input.

| Case | What it tests |
|------|---------------|
| 50 floats all on same anchor paragraph | Float count guard + stacking performance |
| Float height = 10x page height | Size clamping + barrier push chain |
| Negative offsets pushing float above document start (y < 0) | Offset clamping + layout space bounds |
| Floats alternating left/right on every line of a paragraph | Dense constraint overlap resolution |
| Zero-width content area (margins = pageWidth) | Zero-dimension guard |
| Float wider than content area | Size clamping to contentWidth |
| All floats on a single page | Stacking + MAX_PUSH_DISTANCE degradation |
| Float + constraint loop that doesn't converge in 3 iterations | Degradation path (drop constraints at MAX_ITERATIONS) |

**Assertion for all degenerate tests:** Layout completes without throwing. `assertLayoutInvariants` passes. Output is deterministic (same input → same output on repeated runs).

#### Mutation tests

- Insert text before float → invariants hold
- Delete float anchor → no ghost constraints remain
- Split paragraph at float → wrapping continues correctly

---

## 9. Implementation Plan for v2

### Phase 1: Type foundation + invariant harness

1. Split `FloatLayout` into `layoutY`/`layoutX` + `renderY`/`renderX` (3.3). This is the structural change that prevents coordinate space leaks at the type level.
2. Implement `normalizeConstraints` (3.2) — size clamping, offset clamping, count guard, invalid mode fallback.
3. Add monotonic height assertion in `reflowConstrainedBlocks` (debug mode)
4. Add convergence guard + `degradeLayout` fallback (4.4)
5. Build `assertLayoutInvariants` harness
6. Write idempotence, oscillation detector, and constraint stability tests
7. Write adversarial + degenerate layout tests against the CURRENT pipeline (validates the harness)

### Phase 2: Coordinate space enforcement

8. Write failing test: top-bottom float with negative `floatOffset.y`, assert no dead space gap
9. Wire `resolveFloatsGlobalY` to use `layoutY = anchor.globalY` (no Y offset). ExclusionManager reads `layoutY`.
10. Wire `projectFloatsOntoPages` to derive `renderY = layoutY + offsetY`. Renderer reads `renderY`.
11. Verify all modes (square-left, square-right, top-bottom, behind, front)

### Phase 3: Solver correctness

12. Fix stacking order: barrier push THEN stacking resolution (7.2)
13. X coordinate space test: nested list + float (7.5)
14. Early termination + floats guard test (7.6)
15. Disable float resolution in partial/streaming runs (7.4)

### Phase 4: Fuzz testing

16. Build random document generator (include degenerate inputs: extreme sizes, many floats, deep nesting)
17. Run fuzz harness (500 docs x invariant checks)
18. Fix any failures found

### Phase 5: Input model fixes

19. Float-only page click: hit-test floats first, resolve to `docPos` (6.3)
20. Enter-after-float: deeper split-logic float awareness (6.2)
21. Test 6.2 + 6.3 interaction together
22. Cross-page selection highlight (separate PR, not float-specific)

---

## 10. Files Reference

| File | Role |
|------|------|
| `packages/core/src/layout/PageLayout.ts` | Pipeline orchestration, all Stage 1.5-3 functions |
| `packages/core/src/layout/ExclusionManager.ts` | Exclusion rect storage + constraint queries |
| `packages/core/src/layout/BlockLayout.ts` | Per-block layout with `constraintProvider` support |
| `packages/core/src/layout/CharacterMap.ts` | `nearestLineOrAdjacent` for float-only pages |
| `packages/core/src/layout/globalY.test.ts` | 20 existing constraint solver tests |
| `packages/core/src/extensions/built-in/Paragraph.ts` | `cursorIsAfterFloat` split adjustment |
| `packages/core/src/renderer/TileManager.ts` | `overflow: hidden` on page wrappers |
| `docs/float-layout-migration.md` | POC retrospective (keep as historical reference) |

---

## 11. Failure & Degradation Strategy

A robust layout engine defines how it fails, not just how it succeeds. Every degradation rule produces valid (if imperfect) geometry. The user sees a slightly wrong layout, never a crash or infinite loop.

### 11.1 Degradation ladder

Conditions are checked in order. The first matching condition triggers its action. Processing continues — degradation is per-float, not global.

| # | Condition | Action | Result |
|---|-----------|--------|--------|
| 1 | Float dimensions invalid (`width < 1` or `height < 1`) | Skip float entirely | No exclusion, no render |
| 2 | Unknown `wrappingMode` | Convert to `top-bottom` | Safe vertical displacement |
| 3 | Float count exceeds `MAX_FLOATS_PER_BLOCK` per anchor | Excess floats → `top-bottom` | Prevents O(n^2) stacking |
| 4 | Stacking pushes float beyond `MAX_PUSH_DISTANCE` | Convert to `top-bottom` | Float stays near anchor |
| 5 | Float-on-float overlap unresolvable after stacking | Stack vertically ignoring side preference | Guaranteed no overlap |
| 6 | Constraint loop exceeds `MAX_ITERATIONS` | Drop all remaining float constraints, reflow at full width | Text doesn't wrap but floats render correctly |

### 11.2 Post-degradation guarantees

After any degradation:
- `assertLayoutInvariants` still passes
- Output is deterministic (same input → same degraded layout)
- No float overlaps text (exclusion zones may be absent, but floats are positioned)
- No infinite loops (all paths terminate)

### 11.3 Observability

Degradation events should be logged in debug mode:

```ts
if (__DEV__) {
  console.warn(`[layout] float at docPos=${f.docPos} degraded: ${reason}`);
}
```

This surfaces pathological input during development without affecting production.

---

## 12. Key Lessons from the POC

### Constraint engine lessons

1. **This is a constraint solver, not a float positioner.** The POC crossed into building a constraint-based layout engine (closer to a browser than a document editor). That shift matters — the "bugs" are missing invariants, not edge cases.

2. **Enforce coordinate space separation at the type level.** Layout space (`layoutY`, `layoutX`) is for the solver. Visual space (`renderY`, `renderX`) is for the renderer. The POC mixed them with a single `globalY` field, causing the offset bug. v2 splits `FloatLayout` into two explicit position pairs.

3. **Constraints must be monotonic.** Exclusion zones only grow. Block heights only increase. Barriers are frozen. Float positions are pinned. Any violation of monotonicity introduces oscillation risk.

4. **Barriers are constraints, not estimates.** Treating them as "estimates that get refined" creates a hidden feedback loop. Compute once, freeze, let projection handle the rest.

### Debugging lessons

5. **Add browser console diagnostics when debugging layout.** The ExclusionManager semantics were correct during the POC — the bug was in page projection. Reasoning from code alone would have led to the wrong fix.

6. **The "pagination is projection" principle works.** Making pagination read-only eliminated an entire class of mutation bugs (paragraph duplication, Pass 4 reconciliation).

### Architecture insight

7. **This architecture extends beyond floats.** The 2-phase solver (declare constraints → satisfy constraints → project to pages) is the same pattern needed for tables, columns, margin notes, and any future layout feature that constrains text flow. The constraint solver is the foundation, not a float-specific system.
