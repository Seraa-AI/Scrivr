/**
 * TableLayoutEngine — the canvas-native layout for `table` nodes.
 *
 * In Phase 1 this module is a thin shim around `layoutTableRow` (defined
 * inline in `BlockLayout.ts` next to `layoutLeafBlock`) so that PageLayout's
 * existing per-block dispatch can produce row blocks without a separate
 * code path. The shim re-exports the row layout function so tests and
 * future callers can reach it under its conceptual home.
 *
 * Phase 4 grows this module into the real engine described in
 * `docs/tables.md` § Layout: TableMap, columnX precomputation, sandboxed
 * cell layout via explicit `lineIndexOffset` threading, default cell
 * padding, and `RowLayoutResult[]` return shape.
 */

export { layoutTableRow } from "./BlockLayout";
export type { CellSubBlock } from "./BlockLayout";
