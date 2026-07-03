import type { LayoutPage } from "./PageLayout";

/**
 * The tableCell / tableHeader whose laid-out rect contains (x, y) on `page`,
 * returned as the absolute document position of the cell node — or null when
 * the point hits no cell.
 *
 * Cell rects come from the Phase 4 `CellSubBlock`s on `kind: "tableRow"` blocks.
 * `cell.x` is absolute; `cell.y` is relative to the row block's top, so a cell's
 * absolute top is `row.y + cell.y`. Ranges are half-open on the right/bottom so
 * a point on a shared border resolves to a single cell.
 *
 * A `vMerge: "continue"` cell has its own physical rect here and returns its own
 * `cellPos`; range normalization (see cellSelection) maps it to the master.
 */
export function cellAtCoords(
  pages: readonly LayoutPage[],
  x: number,
  y: number,
  page: number,
): number | null {
  const layoutPage = pages.find((p) => p.pageNumber === page);
  if (!layoutPage) return null;

  for (const block of layoutPage.blocks) {
    if (block.kind !== "tableRow" || !block.cells) continue;
    for (const cell of block.cells) {
      const top = block.y + cell.y;
      if (
        x >= cell.x &&
        x < cell.x + cell.width &&
        y >= top &&
        y < top + cell.height
      ) {
        return cell.cellPos;
      }
    }
  }
  return null;
}
