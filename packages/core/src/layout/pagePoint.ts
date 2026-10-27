import type { DocumentLayout } from "./PageLayout";

/**
 * Where on a page a point fell.
 *
 * Click routing mostly ignores this — a click anywhere on a page places a
 * caret. Hover cannot: a pointer in the margin beside a link must not peek
 * the link. See docs/hover-popovers-rfc.md §3.
 */
export type PageRegion =
  /** Inside the content box. */
  | "content"
  /** Left or right of the content box, between the header and footer strips. */
  | "margin"
  /** The strip above the content box — the header band, or the top margin when no band is laid out. */
  | "header"
  /** The strip below the content box — the footer band, or the bottom margin when no band is laid out. */
  | "footer"
  /** Between two pages (paged mode). */
  | "gap"
  /** Left or right of the page, above the first page, or past the last one. */
  | "outside";

export interface PagePoint {
  page: number;
  /**
   * Page-local. In a gap, `y` is clamped to the bottom of the page above so
   * click callers keep today's "click below the text" behaviour.
   */
  x: number;
  y: number;
  region: PageRegion;
}

/** The parts of a layout region classification reads. */
export type PageRegionLayout = Pick<DocumentLayout, "pageConfig" | "metrics" | "totalContentHeight">;

export interface PagePointContext {
  /** Top-left of the tiles container, in client coordinates. */
  origin: { left: number; top: number };
  pageless: boolean;
  /** Tile height plus the inter-page gap in paged mode; tile height in pageless. */
  slotHeight: number;
  tileHeight: number;
  layout: PageRegionLayout;
}

/**
 * Client point → page point. Click, hover and drags all read this, so they
 * agree on which page a point is on and where on it.
 *
 * Never null: callers that act on any point (click places a caret, drags
 * track the pointer) get one, and callers that must not (hover) read `region`.
 */
export function resolvePagePoint(
  clientX: number,
  clientY: number,
  ctx: PagePointContext,
): PagePoint {
  const x = clientX - ctx.origin.left;
  const visualY = clientY - ctx.origin.top;

  if (ctx.pageless) {
    return { page: 1, x, y: visualY, region: pageRegionAt(ctx.layout, 1, x, visualY) ?? "outside" };
  }

  const tileIndex = Math.floor(visualY / ctx.slotHeight);
  const page = tileIndex + 1;
  const y = visualY - tileIndex * ctx.slotHeight;
  // Above the first page the slot math lands in "page 0"'s gap; it is off the
  // pages, not between two of them.
  if (visualY < 0) return { page, x, y, region: "outside" };
  if (y >= ctx.tileHeight) {
    return { page, x, y: ctx.tileHeight, region: "gap" };
  }
  return { page, x, y, region: pageRegionAt(ctx.layout, page, x, y) ?? "outside" };
}

/**
 * Which region of `page` the page-local point (x, y) is in. Null when the page
 * has no metrics (not laid out, or past the last page).
 *
 * The header and footer strips span the full page width — a point in the top
 * corner is `header`, not `margin` — because that is the strip a double-click
 * activates.
 *
 * With no band laid out, the top and bottom margins still count as `header`
 * and `footer`: Word and Docs treat the margin strip as the place to
 * double-click to create a header, and this keeps that affordance live
 * before any header/footer policy exists. When a band is laid out, its
 * resolved bounds win.
 *
 * Pure geometry, never a gap: a point in the gap is decided by slot math in
 * `resolvePagePoint` before this runs.
 */
export function pageRegionAt(
  layout: PageRegionLayout,
  page: number,
  x: number,
  y: number,
): PageRegion | null {
  const metrics = layout.metrics?.[page - 1];
  if (!metrics) return null;
  const { pageConfig } = layout;
  const { pageWidth, pageHeight, margins } = pageConfig;
  const pageless = pageConfig.pageless === true;

  if (x < 0 || x > pageWidth || y < 0) return "outside";
  if (pageless ? y > layout.totalContentHeight : y > pageHeight) return "outside";

  const headerBottom = metrics.headerHeight > 0 ? metrics.contentTop : margins.top;
  if (y < headerBottom) return "header";

  // A pageless page has no bottom: `pageHeight` is unused there, so no footer strip.
  if (!pageless) {
    const footerTop =
      metrics.footerHeight > 0 ? metrics.footerTop : pageHeight - margins.bottom;
    if (y > footerTop) return "footer";
  }

  if (x < margins.left || x > pageWidth - margins.right) return "margin";
  return "content";
}
