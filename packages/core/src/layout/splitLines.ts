/**
 * Shared line-fitting primitive used by every layout consumer that needs
 * to split a flat line list against a single vertical capacity.
 *
 * This is the smallest reusable kernel inside `paginateFlow`'s split loop
 * (`PageLayout.ts:606-723` today) — the inner "walk lines, accumulate height,
 * stop when capacity runs out" step. `paginateFlow`'s enclosing control flow
 * (gap suppression, margin collapsing, leaf-block handling, hard page breaks)
 * is NOT shared here because it's body-specific and can't be cleanly factored
 * without a larger refactor. But the inner accumulator is genuinely reusable,
 * and extracting it means:
 *
 * - The footnote plugin's `bandFill` (see `docs/multi-surface-architecture.md`
 *   §8.7.3) calls this instead of reimplementing the walk
 * - Future iterative chrome contributors (balanced columns, line-number gutters,
 *   widow/orphan enforcement) get it for free
 * - `paginateFlow`'s split loop can eventually call this too, collapsing the
 *   two implementations into one (not done in Phase 0 because it touches the
 *   hot loop — revisit after footnotes land when we have a second real caller
 *   to validate the shape against)
 *
 * The function is intentionally boring: no fancy break-point selection, no
 * widow/orphan awareness, no lookahead. It just walks lines top-down, takes
 * as many as fit, and returns the split point. Callers that want smarter
 * rules layer them on top.
 *
 * See `docs/weekend-plan-2026-04-12.md` §PR 1 step 1.2 and
 * `docs/multi-surface-architecture.md` §8.7.1 ("Reuse what exists; don't
 * build a 'subflow engine'") for the full rationale.
 */

import type { LayoutLine } from "./LineBreaker";

export interface FitLinesResult {
  /** Lines that fit within the capacity, in input order. */
  fitted: LayoutLine[];
  /**
   * Lines that didn't fit, in input order. Empty when all input lines fit.
   * These are the caller's responsibility to place elsewhere — typically
   * on the next page or in a spill queue.
   */
  rest: LayoutLine[];
  /**
   * Sum of `lineHeight` across the fitted lines. Always 0 when `fitted` is empty.
   * Callers use this to advance their Y cursor after placing the fitted part.
   */
  fittedHeight: number;
}

/**
 * Walk a flat line list and return the largest prefix that fits within a
 * given vertical capacity, plus the remainder.
 *
 * Greedy and monotonic: lines are consumed in order, no reordering, no
 * skipping. If `lines[0].lineHeight > capacity`, zero lines fit and the
 * caller decides how to handle overflow (force one line on an empty page,
 * spill to the next capacity, etc.).
 *
 * Edge cases:
 * - Empty `lines` input → `{ fitted: [], rest: [], fittedHeight: 0 }`
 * - `capacity <= 0` → `{ fitted: [], rest: lines, fittedHeight: 0 }`
 * - Capacity exactly matches total height → all lines fitted, `rest` empty
 * - Single line larger than capacity → zero fit, `rest` is the full input
 *
 * Performance: O(fitted.length) walk, stops at the first line that doesn't
 * fit. Array slicing at the end is O(fitted.length + rest.length) which is
 * unavoidable without changing the return shape. Callers that care about
 * allocations can compare `fitted.length === lines.length` to detect the
 * "all fit" case before slicing — but for typical footnote bodies (dozens
 * of lines, not thousands) this isn't worth optimizing.
 *
 * This function is PURE — no side effects, no closure state, no external
 * reads. Deterministic given its inputs, safe to call from hot loops and
 * iterative layout passes.
 */
export function fitLinesInCapacity(
  lines: LayoutLine[],
  capacity: number,
): FitLinesResult {
  if (lines.length === 0 || capacity <= 0) {
    return { fitted: [], rest: lines, fittedHeight: 0 };
  }

  let fittedHeight = 0;
  let i = 0;
  while (i < lines.length) {
    const next = lines[i]!;
    if (fittedHeight + next.lineHeight > capacity) break;
    fittedHeight += next.lineHeight;
    i++;
  }

  return {
    fitted: lines.slice(0, i),
    rest: lines.slice(i),
    fittedHeight,
  };
}
