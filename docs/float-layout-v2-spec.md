# Float Layout v2 — Full Specification

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

## 2. Solution: Pre-Pagination Constraint Solving

Move all float resolution and text reflow **before** pagination. Work in continuous global-Y space (one tall strip, no page boundaries). Pagination becomes a read-only projection.

### The new pipeline

```
Stage 1:    buildBlockFlow          — measure all blocks (unconstrained)
Stage 1.5:  assignGlobalY           — stamp continuous Y with CSS-style margin collapsing
Stage 1.75: constraint loop         — resolve floats + reflow text (pre-pagination)
  ├── Step 1: Estimate page boundaries from unconstrained flow heights
  ├── Step 2: resolveFloatsGlobalY — position floats, build global-Y exclusions
  └── Step 3: reflowConstrainedBlocks — re-layout overlapping blocks (fixed-point, max 3 iter)
Stage 2:    paginateFlow            — assign blocks to pages (read-only for constraints)
Stage 3:    projectFloatsOntoPages  — derive page-local float coords from globalY
Stage 4:    buildFragments          — fragment index for tile renderer
```

### Net result (from POC)

- **-397 lines** of code (deleted ~550 lines of applyFloatLayout, added ~153 for new functions)
- Paragraph duplication bug fixed for free
- ExclusionManager works in both page-scoped (legacy) and global-Y (new) modes
- Constraint loop converges in 1-2 iterations for typical documents

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

### 3.2 `resolveFloatsGlobalY(flows, margins, pageWidth, contentWidth, pageBreakYs)`

Finds zero-width float anchor spans in flows, positions each float in global-Y space, builds exclusion rects.

**Returns:** `{ floats: FloatLayout[], exclusionMgr: ExclusionManager } | null`
Returns `null` when no float anchors exist (fast path — skip entire constraint loop).

**Per-float positioning:**

1. **Collect anchor:** Walk flows → lines → spans, find `span.kind === "object" && span.width === 0` with `wrappingMode` set
2. **Read attributes:** `wrappingMode`, `floatOffset.x`, `floatOffset.y`, node width/height
3. **X position:**
   - `square-left`: `contentX + offsetX`
   - `square-right`: `contentRight - width + offsetX`
   - `top-bottom`: centered or full-width (implementation choice)
   - `behind` / `front`: same X logic, no exclusion rect
   - Clamped to `[contentX, contentRight - width]`
4. **Y position:** `candidateY = anchor.globalY + offsetY`
5. **Stacking:** While any previously-placed same-side float overlaps horizontally AND vertically, push `candidateY` below it (`overlap.globalY + overlap.height + FLOAT_MARGIN`)
6. **Page break barriers:** If `candidateY` and `candidateY + height` straddle a barrier Y, push `candidateY = barrierY` (float goes entirely to next page)
7. **Exclusion rect:** Add to ExclusionManager with `FLOAT_MARGIN_GLOBAL = 8px` padding on all sides. Side is `"left"` / `"right"` / `"full"` based on wrapping mode. No `page` field (global-Y mode).

**Key invariant:** Float positions are resolved ONCE from unconstrained flow positions and pinned. They are never re-resolved during the constraint loop.

### 3.3 `reflowConstrainedBlocks(flows, exclusionMgr, margins, contentWidth, measurer, fontConfig, ...)`

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

### 3.4 `recomputeGlobalY(flows, startIndex)`

Re-stamps `globalY` on flows from `startIndex` onward using the same margin-collapsing logic as `assignGlobalY`. Only called after `reflowConstrainedBlocks` changes block heights.

### 3.5 `projectFloatsOntoPages(paginatedLayout, resolvedFloats, pageConfig)`

After pagination, maps each float from global-Y to page-local coordinates.

**Algorithm:**
1. Build anchor map: walk paginated pages → blocks → lines → spans, collect `docPos → { page, blockY }` for float anchors
2. For each float:
   - `delta = float.globalY - float.anchorBlockY`
   - `candidateY = anchor.blockY + delta`
   - If `candidateY + height > pageBottom` → overflow to `anchorPage + 1`, place at `contentTop`
   - Otherwise: `page = anchor.page, y = candidateY`
3. Materialise empty `LayoutPage` entries for floats that land on non-existent pages
4. Run `clearOrphanedConstraints` on continuation blocks

### 3.6 `clearOrphanedConstraints(pages, floats)`

When a constrained block splits across pages during pagination, overflow lines may carry stale `constraintX` / `effectiveWidth` from the pre-pagination reflow. Lines on continuation blocks that don't overlap any float on their page get cleared.

**Algorithm:**
- No wrapping floats on page → clear ALL continuation block constraints
- Has wrapping floats → per-line overlap check, clear only non-overlapping lines

### 3.7 `ExclusionManager` (dual-mode)

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

### 4.2 Page boundaries are estimated, not exact

The chicken-and-egg: you can't know page boundaries before pagination, but floats need page awareness to avoid straddling page breaks. Solution: walk unconstrained flows, accumulate heights, mark barrier Y values where page breaks will occur. These estimates are accurate because:
- Zero-height float anchors don't change height during reflow
- Barrier estimation uses the same margin-collapsing logic as `paginateFlow`

### 4.3 Pagination is read-only for constraints

`paginateFlow` receives flows with final constrained heights. It assigns blocks to pages and splits at boundaries. It does NOT re-layout anything. This is the "pagination is projection" principle.

### 4.4 Float page membership from pre-reflow anchor position

CSS spec rule: a float's page is determined by where its anchor was BEFORE text reflowed around it. The constraint loop grows blocks (more lines = taller), but that growth must not change which page a float belongs to. `projectFloatsOntoPages` uses the anchor's paginated position, which reflects pre-reflow height.

### 4.5 `updateFloatAnchors` — defined but not called

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

### 6.1 Float offset spacing regression — OPEN

**Symptom:** Top-bottom float with negative `floatOffset.y` (e.g. `{x: -48, y: -45}`) creates ~45px blank gap above and below the image.

**Root cause:** In `resolveFloatsGlobalY`, the exclusion rect Y is derived from `candidateY = anchor.globalY + offsetY`. For top-bottom mode, the offset shifts the exclusion zone away from the anchor, leaving dead space between the anchor paragraph and the exclusion zone.

In the old system, `applyFloatLayout` applied offsets in page-local coordinates AFTER pagination. The text paragraph was already placed, and the float shifted visually without creating a gap in the flow. The new system shifts the float in continuous Y space BEFORE pagination, which creates a gap that pagination preserves.

**Fix direction:** For top-bottom mode, the exclusion zone should span from `anchor.globalY` (not `candidateY`) downward: `[anchor.globalY, anchor.globalY + imageHeight + margin]`. The Y offset should only affect where the image is RENDERED (`float.y`), not where text is BLOCKED (exclusion rect). Side-float modes (square-left, square-right) may need the same treatment — offset shifts the rendered image but the exclusion hugs the anchor.

**Rule:** `floatOffset` is a rendering offset, not a constraint offset. Exclusion rects are always anchored to `anchor.globalY`. The float's visual position (`float.globalY`) includes the offset.

### 6.2 Enter after float inserts text above — PARTIALLY FIXED

**Symptom:** With a float image in top-bottom mode, text typed after the image appears visually below it. Pressing Enter splits the paragraph, but text ends up above the image.

**POC fix:** `cursorIsAfterFloat` in `Paragraph.ts` adjusts the split point so the float anchor lands in the lower block. This works for the simple case (cursor immediately after float).

**Remaining issue:** The fix is positional — it checks `nodeBefore`. If the cursor is several characters past the float (text between float and cursor), the split may still produce unexpected results. The fundamental tension is that doc order (float is inline, mixed with text) disagrees with visual order (float is rendered below/beside text).

**Fix direction for v2:** Consider making the split logic float-aware at a deeper level. After any split in a paragraph containing a float, verify that the float anchor ends up in the block that corresponds to its VISUAL position, not just its doc position.

### 6.3 Float-only page cursor jumps to position 0 — PARTIALLY FIXED

**Symptom:** Click on a page with only a float (no text lines) → `posAtCoords` returns 0 → cursor jumps to document start.

**POC fix:** `nearestLineOrAdjacent` in `CharacterMap.ts` searches adjacent pages when the clicked page has no text lines.

**Remaining issue:** The fix finds the nearest line on an adjacent page, but the user's click was on the float-only page. The cursor lands on the adjacent page's text, not near the float. For a better UX, clicking near a float should select the float's anchor position.

**Fix direction for v2:** If the page has floats but no text lines, resolve the click to the float anchor's doc position instead of searching adjacent pages. This requires `posAtCoords` to be float-aware: check if the click coordinates fall within a float's bounding box, and if so, return the float's `docPos`.

### 6.4 Cross-page selection highlight — OPEN (pre-existing)

**Symptom:** Selection highlight renders on page 1 but doesn't continue onto page 2 when selection spans pages.

**Not caused by the float migration** — this is a pre-existing bug in `OverlayRenderer` / `TileManager.paintOverlay`. Including here because the migration's move to global-Y coordinates creates a path to fix it (selection ranges can now be resolved in continuous space).

---

## 7. Hardening Items (Robustness, Not Bugs)

These are edge cases identified during review. Not blocking for v2 but should be addressed before the float system is considered production-ready.

### 7.1 Page barrier recomputation after constraint loop

Barriers are estimated from unconstrained flow heights. After the constraint loop changes heights, barriers could be stale. If a constrained block's height growth pushes a downstream float across a page boundary, the barrier is wrong.

**Fix:** After the constraint loop converges, recompute barriers from the final constrained heights. If any barrier moved, re-check float positions (single pass, no re-resolve).

### 7.2 Float chain + barrier stacking

When a page-break barrier pushes float B down, B could now overlap float A (which was placed before the push). After barrier adjustment, re-run stacking resolution against prior floats.

**Fix:** In `resolveFloatsGlobalY`, after barrier push, re-check overlap with all previously-placed floats (not just same-side).

### 7.3 Non-zero-height anchor support

`updateFloatAnchors` is defined but not called. Currently safe because all float anchors are zero-height spans. If we add captioned floats or float groups with non-zero anchor height, the constraint loop needs to call `updateFloatAnchors` after `recomputeGlobalY` — without re-resolving float positions (to avoid oscillation).

### 7.4 Streaming + partial float resolution

When `maxBlocks` cutoff stops layout mid-document, floats are resolved from incomplete flows. Downstream anchors don't exist yet, so float stacking and exclusion zones are incomplete. On resume, positions could shift.

**Options:** Disable float resolution in partial runs, or persist float state across chunks.

### 7.5 List indent + exclusion coordinate space

`ExclusionManager.getConstraint` receives `blockContentX = margins.left + indentLeft`. Exclusion rects are in absolute content coordinates. If the exclusion was placed at absolute X but the block queries at indented X, constraints could over- or under-constrain.

**Fix:** Verify with a test: nested list with float inside a list item. Check that constraint width accounts for the indent correctly.

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

#### Cache corruption test

`runPipeline(doc, { measureCache: undefined })` must equal `runPipeline(doc, { measureCache: new WeakMap() })`.

#### Mutation tests

- Insert text before float → invariants hold
- Delete float anchor → no ghost constraints remain
- Split paragraph at float → wrapping continues correctly

---

## 9. Implementation Plan for v2

### Phase 1: Foundation (no behavior change)

1. Add changeset (patch for `@scrivr/core`)
2. Build `assertLayoutInvariants` harness
3. Write idempotence + oscillation detector tests
4. Write adversarial float case tests against the CURRENT pipeline (they should pass — this validates the harness)

### Phase 2: Fix the float offset bug

5. Write failing test: top-bottom float with negative `floatOffset.y`, assert no dead space gap
6. Fix `resolveFloatsGlobalY`: separate rendered position (`float.globalY` includes offset) from exclusion zone (`anchored to anchor.globalY`). The exclusion rect should be:
   ```
   y: anchor.globalY - FLOAT_MARGIN
   bottom: anchor.globalY + nodeHeight + FLOAT_MARGIN
   ```
   The float's visual `globalY` remains `anchor.globalY + offsetY`.
7. Verify fix doesn't break side-float offset behavior

### Phase 3: Hardening

8. Barrier recomputation after constraint loop (7.1)
9. Float chain + barrier stacking (7.2)
10. List indent + exclusion coordinate space test (7.5)
11. Early termination + floats guard test (7.6)

### Phase 4: Fuzz testing

12. Build random document generator
13. Run fuzz harness (500 docs × invariant checks)
14. Fix any failures found

### Phase 5: Remaining bug fixes

15. Improve Enter-after-float to handle cursor-not-immediately-after-float
16. Float-only page click → resolve to float anchor docPos
17. Cross-page selection highlight (separate PR, not float-specific)

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

## 11. Key Lessons from the POC

1. **Never re-resolve floats inside the constraint loop.** Oscillation is guaranteed when a float constrains its own anchor block. Resolve once, pin, reflow only.

2. **Page boundaries must be estimated before the constraint loop.** Without barriers, floats get projected to wrong pages and text gets constrained for floats that aren't beside it.

3. **`floatOffset` is cosmetic, not structural.** The offset shifts where the image is painted, not where text is blocked. The POC applied offset to both, creating dead space. v2 must separate rendered position from exclusion zone.

4. **Add browser console diagnostics when debugging layout.** The ExclusionManager semantics were correct during the POC — the bug was in page projection. Reasoning from code alone would have led to the wrong fix.

5. **The "pagination is projection" principle works.** Making pagination read-only eliminated an entire class of mutation bugs (paragraph duplication, Pass 4 reconciliation).
