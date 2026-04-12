/**
 * Shared line-fitting primitive — splits a flat line list against a vertical
 * capacity. Used by paginateFlow and future consumers (footnotes, columns).
 */

import type { LayoutLine } from "./LineBreaker";

export interface FitLinesResult {
  /** Lines that fit within the capacity. */
  fitted: LayoutLine[];
  /** Lines that didn't fit (caller places elsewhere). */
  rest: LayoutLine[];
  /** Sum of lineHeight across fitted lines. */
  fittedHeight: number;
}

/**
 * Greedily consume lines until capacity is exhausted. Pure, O(n).
 * If lines[0] exceeds capacity, zero lines fit — caller handles overflow.
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
