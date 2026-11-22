/**
 * Rounds away arithmetic noise while keeping every difference a reader could
 * see. Without it a baseline fills up with `41.9999999998` diffs from
 * reassociated float math, and a harness that cries wolf gets ignored — which
 * is the same as not having one.
 *
 * For tests that snapshot drawn or laid-out numbers. Exported from core so
 * every such log can share one rule and agree on whether a value moved.
 */
export function normalizeDrawNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * 1e3) / 1e3;
  return Object.is(rounded, -0) ? 0 : rounded;
}
