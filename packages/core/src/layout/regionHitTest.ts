import type { LayoutBlock } from "./BlockLayout";
import type { LayoutPage } from "./PageLayout";

/**
 * The innermost composite region whose laid-out rect contains (x, y) on
 * `page` — a cell of a table nested in a cell wins over its outer cell —
 * returned as the absolute document position of its node, or null when the
 * point hits no region.
 *
 * A region's `x` is absolute; its `y` is relative to its unit's top, so its
 * absolute top is `unit.y + region.y`. Ranges are half-open on the right and
 * bottom, so a point on a shared border resolves to a single region.
 */
export function regionAtCoords(
  pages: readonly LayoutPage[],
  x: number,
  y: number,
  page: number,
): number | null {
  const layoutPage = pages.find((p) => p.pageNumber === page);
  return layoutPage ? regionIn(layoutPage.blocks, x, y, 0) : null;
}

/** The innermost region at (x, y) among `blocks`, whose `y` is relative to `originY`. */
function regionIn(blocks: readonly LayoutBlock[], x: number, y: number, originY: number): number | null {
  for (const block of blocks) {
    const unitTop = originY + block.y;
    for (const region of block.regions ?? []) {
      const top = unitTop + region.y;
      if (x >= region.x && x < region.x + region.width && y >= top && y < top + region.height) {
        // A composite nested in the region (a table in a cell) owns its own regions.
        return regionIn(region.blocks, x, y, unitTop) ?? region.pos;
      }
    }
  }
  return null;
}
