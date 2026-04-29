# Float v2 — Logic & Dataflow Improvements

> **Status:** Design doc for the next iteration of the global-Y constraint solver.
> Written 2026-04-29 after the initial v2 implementation shipped on `feat/float-layout-v2`.
> These are logic/dataflow fixes, not architecture changes.

---

## Invariants

These hold across the entire float pipeline. Any fix that violates one is wrong.

- `layoutY` never includes `visualOffsetY`
- `renderY` always includes `visualOffsetY`
- Exclusion rects are based on `layoutY`, not `renderY`
- Early termination compares block **start** placement, not end placement
- After any reflow that changes height, downstream `globalY` must be recomputed

---

## 1. `floatOffset.y` is lost after normalization

### Problem

`normalizeConstraints` clamps `offsetY` and stores it on `NormalizedFloatInput`. But `FloatLayout` never stores it. `projectFloatsOntoPages` computes:

```ts
const candidateY = anchor.blockY + delta;
```

The v2 spec says `renderY = projected layoutY + floatOffset.y`, but `floatOffset.y` is never applied. The visual offset is silently dropped.

### Fix

Add visual offset fields to `FloatLayout`:

```ts
/** Visual Y offset — shifts rendered position without affecting layout/exclusion. */
visualOffsetY: number;
/** Visual X offset — already included in layoutX, stored for reference. */
visualOffsetX: number;
```

Set during `resolveFloatsGlobalY` from `NormalizedFloatInput`:

```ts
visualOffsetY: input.offsetY,
visualOffsetX: input.offsetX,
```

Apply during projection:

```ts
const candidateY = anchor.blockY + delta + f.visualOffsetY;
```

### Impact

**Behavioral bug fix.** Without this, dragging a float image vertically (which sets `floatOffset.y`) has no visual effect in the new pipeline. The old `applyFloatLayout` included offset in `candidateY`.

### Files

- `PageLayout.ts` — `FloatLayout` interface, `resolveFloatsGlobalY`, `projectFloatsOntoPages`

---

## 2. Degradation recompute is a no-op

### Problem

In `solveConstraints`, the degradation path after `MAX_ITERATIONS`:

```ts
recomputeGlobalY(flows, 0);
```

But `recomputeGlobalY` exits early when `startIndex <= 0`:

```ts
if (startIndex >= flows.length || startIndex <= 0) return;
```

So after dropping all constraints and reflowing at full width, downstream `globalY` values stay stale from the last constrained iteration.

### Fix

Option A — use `assignGlobalY` instead:

```ts
if (!converged) {
  resolved.exclusionMgr.clear();
  reflowConstrainedBlocks(...);
  assignGlobalY(flows, flows[0]?.globalY ?? margins.top);
}
```

Option B — fix `recomputeGlobalY` to accept `startIndex = 0`:

```ts
if (startIndex >= flows.length) return;
if (startIndex <= 0) {
  // Full recompute — use first flow's globalY as anchor
  assignGlobalY(flows, flows[0]?.globalY ?? 0);
  return;
}
```

Option A is simpler and doesn't change `recomputeGlobalY`'s contract.

### Impact

**Correctness fix for the degradation path.** Only triggers when the solver fails to converge in 5 iterations (pathological input). Without this fix, degraded layouts have stale Y positions — blocks may overlap or leave gaps.

### Files

- `PageLayout.ts` — `solveConstraints` degradation branch

---

## 3. Cache placement writes wrong page after splits

### Problem

At the end of `paginateFlow`, the measure cache gets:

```ts
cachedEntry.placedPage = currentPage.pageNumber;
```

For blocks that split across pages, `currentPage` is the page where the **last fragment** landed, not where the block started. Phase 1b early termination compares against this cached page number and may decide to copy blocks from the wrong position.

### Fix

Store both start and end placement:

```ts
interface MeasureCacheEntry {
  // ... existing fields ...
  placedStartPage: number;
  placedStartTargetY: number;
  placedEndPage: number;
}
```

Phase 1b should compare against `placedStartPage` and `placedStartTargetY` for early termination decisions.

### Impact

**Correctness fix for incremental layout.** Affects documents where a block splits across pages AND the user edits content before the split point. Without this, Phase 1b may skip re-pagination when it shouldn't, producing stale page assignments.

### Files

- `PageLayout.ts` — `paginateFlow` cache write, Phase 1b early termination check

---

## 4. `clearOrphanedConstraints` only clears metadata, doesn't re-layout

### Problem

`clearOrphanedConstraints` deletes `constraintX` and `effectiveWidth` from lines on continuation blocks that no longer overlap floats. But the line's `spans`, `width`, and break points still reflect the constrained layout. The line was broken at a narrower width — removing the constraint metadata doesn't reflow the text.

Visual effect: text on cleared lines uses the full page width for cursor positioning and justify spacing, but the actual character positions are from the narrower constrained layout. Text may appear stretched or misaligned.

### Fix

When clearing constraints, re-layout the block at full width:

```ts
function clearOrphanedConstraints(pages, floats, ctx): void {
  // ... existing logic to find orphaned continuation blocks ...
  if (needsRelayout) {
    const reflowed = layoutBlock(block.node, {
      nodePos: block.nodePos,
      x: block.x,
      y: block.y,
      availableWidth: block.availableWidth,
      page: page.pageNumber,
      measurer: ctx.measurer,
      fontConfig: ctx.fontConfig,
    });
    block.lines = reflowed.lines;
    block.height = reflowed.height;
  }
}
```

This requires passing the reflow context (`measurer`, `fontConfig`) to `clearOrphanedConstraints`, which currently only takes `pages` and `floats`.

### Impact

**Visual correctness fix.** Affects documents where a constrained paragraph splits across pages and the continuation lands on a page without the float. The text looks wrong (constrained width breaks) even though the constraint metadata is cleared.

### Files

- `PageLayout.ts` — `clearOrphanedConstraints` signature + implementation

---

## 5. Projection reconciliation mutates pages after `_pass1Pages` snapshot

### Problem

`projectFloatsOntoPages` does:

```ts
const pass1Pages = pages.map(p => ({ pageNumber: p.pageNumber, blocks: [...p.blocks] }));
// ... projection ...
reconcileProjectedFloatConstraints(paginatedLayout, floats, ...);
// paginatedLayout.pages is now mutated by reconciliation
return { ...paginatedLayout, floats, _pass1Pages: pass1Pages };
```

`_pass1Pages` captures pages BEFORE projection but AFTER pagination. Reconciliation then mutates the same `pages` array (shifting blocks, splitting overflows). The returned `_pass1Pages` is correct, but the dataflow is fragile — any future code that reads `pages` between the snapshot and reconciliation sees an intermediate state.

### Fix

Make the mutation boundary explicit:

```ts
const preProjectionPages = clonePages(pages);
// ... projection + reconciliation mutates pages ...
return { ...paginatedLayout, pages: paginatedLayout.pages, _pass1Pages: preProjectionPages };
```

Or better — reconciliation should return new pages instead of mutating:

```ts
const reconciledPages = reconcileProjectedFloatConstraints(pages, floats, ...);
return { ...paginatedLayout, pages: reconciledPages, _pass1Pages: preProjectionPages };
```

### Impact

**Defensive improvement.** Not a current bug, but a mutation hazard. The current code works because reconciliation is the last step before return. If any code is added between snapshot and return, it will see partially-reconciled pages.

### Files

- `PageLayout.ts` — `projectFloatsOntoPages`

---

## 6. Explicit changed flag from reconciliation

### Problem

`projectedReconciliationHash` includes block Y, height, line count, line width, lineHeight, constraintX, and effectiveWidth. But it ignores:

- Span positions (x offsets within lines)
- Span text content
- Span widths

If text line contents change but line count and height stay the same, the hash won't detect it. Convergence may stop prematurely.

### Fix

Instead of making the hash more detailed, return an explicit changed flag from reconciliation:

```ts
interface ReconciliationResult {
  pages: LayoutPage[];
  changedBlocks: Set<number>;
  floatMoved: boolean;
}
```

Convergence = `changedBlocks.size === 0 && !floatMoved`.

This is cleaner than strengthening the hash — the reconciliation step already knows what it changed.

### Impact

**Robustness improvement.** Low probability of triggering in practice (line count/height changes are the main signal), but could cause subtle misalignment in edge cases.

### Files

- `PageLayout.ts` — `reconcileProjectedFloatConstraints` return type, convergence check

---

## 7. Re-resolve floats inside solver loop (v2.1)

### Problem

Current solver loop:

```
resolve floats ONCE
for each iteration:
  reflow constrained blocks
  recompute globalY
```

But when block heights change during reflow, anchor block positions shift. The float positions (computed from the original `anchorFlow.globalY`) become stale. The exclusion zones no longer match the actual float render positions.

The v2 spec explicitly says "float positions are pinned" to prevent oscillation. But the POC proved this causes stale exclusions when anchor blocks move significantly.

### Fix

Re-resolve floats inside the loop, but with a dampening strategy:

```ts
for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
  const resolved = resolveFloatsGlobalY(flows, inputs, ...);
  const result = reflowConstrainedBlocks(flows, resolved.exclusionMgr, ...);
  if (!result.changed) { converged = true; break; }
  recomputeGlobalY(flows, result.firstChangedIndex + 1);
}
```

**Oscillation prevention:** Track the previous iteration's float positions. If a float's `layoutY` is within 1px of its previous position, pin it. This damps the oscillation without freezing floats at stale positions.

```ts
interface PinnedFloat {
  docPos: number;
  layoutY: number;
  pinned: boolean;
}

// After resolveFloatsGlobalY:
for (const f of resolved.floats) {
  const prev = previousPositions.get(f.docPos);
  if (prev && Math.abs(f.layoutY - prev) < 1) {
    f.layoutY = prev; // pin
  }
}
```

### Risk

This is the highest-risk change. The POC froze floats specifically to avoid oscillation. The dampening strategy adds complexity. **Test with the fuzz suite before and after** — the oscillation detector (100 docs x 3 runs) must still pass. Treat as v2.1, not part of the first hardening pass.

### Impact

**Correctness improvement.** Without re-resolution, floats in documents where anchor blocks grow significantly during reflow (e.g., a float on paragraph 1 causes paragraph 1 to grow, shifting paragraph 2's anchor) will have stale exclusion zones.

### Files

- `PageLayout.ts` — `solveConstraints`

---

## Priority Order

| # | Fix | Type | Risk | Effort |
|---|-----|------|------|--------|
| 1 | Preserve and apply `floatOffset.y` | Bug fix | Low | Small — add field + 2 lines in projection |
| 2 | Fix degradation recompute | Bug fix | Low | 1 line change |
| 3 | Store split block start placement in cache | Bug fix | Medium | Cache schema change + Phase 1b update |
| 4 | Re-layout orphaned lines, not just clear metadata | Bug fix | Medium | Needs reflow context threading |
| 5 | Make projection mutation boundary explicit | Defensive | Low | Structural only |
| 6 | Explicit changed flag from reconciliation | Defensive | Low | Replace hash with change tracking |
| 7 | Re-resolve floats inside solver loop | Enhancement | High | Oscillation risk — needs dampening + fuzz validation |

**Do 1–4 first** — concrete bugs with clear fixes. Items 5–6 are defensive hardening. Item 7 (re-resolve floats) is v2.1 — correct in theory, but reopens oscillation risk. Keep it isolated behind fuzz tests.

---

## Test Plan

Each fix ships with a test that fails before and passes after.

| # | Test |
|---|------|
| 1 | Dragging float vertically changes `renderY` but not exclusion rect |
| 2 | Solver degradation resets downstream `globalY` (no stale positions) |
| 3 | Split block stores start page for early termination |
| 4 | Orphaned continuation block reflows to full width (spans match unconstrained layout) |
| 5 | Projection reconciliation preserves `_pass1Pages` baseline |
| 6 | Reconciliation returns explicit changed flag; convergence uses it |
| 7 | Fuzz suite (100 docs × 3 runs): no oscillation after re-resolve |
