import type { LayoutPage } from "./PageLayout";

/**
 * The composite region whose laid-out rect contains (x, y) on `page`, returned
 * as the absolute document position of its node — or null when the point hits
 * no region.
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
  if (!layoutPage) return null;

  for (const block of layoutPage.blocks) {
    for (const region of block.regions ?? []) {
      const top = block.y + region.y;
      if (x >= region.x && x < region.x + region.width && y >= top && y < top + region.height) {
        return region.pos;
      }
    }
  }
  return null;
}
