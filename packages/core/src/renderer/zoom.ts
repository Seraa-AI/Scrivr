import type { PageConfig } from "../layout/PageLayout";

/**
 * How large the document is shown: a factor (1 is 100%), or a fit to the
 * view the editor is scrolled in — its width, or the whole page — which
 * follows the view as it resizes. A view scale only: layout, the document
 * and every page-unit coordinate are the same at every zoom.
 */
export type ZoomRequest = number | "fit-width" | "fit-page";

/** Word's range: 10% to 500%. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 5;

/** The size, in CSS pixels, that a fit fills. */
export interface ZoomViewport {
  width: number;
  height: number;
}

type PageSize = Pick<PageConfig, "pageWidth" | "pageHeight">;

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const FITS: Record<Exclude<ZoomRequest, number>, (view: ZoomViewport, page: PageSize) => number | null> = {
  "fit-width": (view, page) => (view.width > 0 ? view.width / page.pageWidth : null),
  "fit-page": (view, page) =>
    view.width > 0 && view.height > 0 ? Math.min(view.width / page.pageWidth, view.height / page.pageHeight) : null,
};

/**
 * The factor `request` shows a `page` at in a view of `viewport`, within the
 * range. Null for a fit with nothing to measure — no view yet, or a hidden
 * one — which leaves the factor as it was. NaN, or a request plain
 * JavaScript made up, is 100%.
 */
export function resolveZoom(request: ZoomRequest, viewport: ZoomViewport | null, page: PageSize): number | null {
  if (typeof request === "number") return Number.isNaN(request) ? 1 : clampZoom(request);
  if (!Object.hasOwn(FITS, request)) return 1;
  if (!viewport) return null;
  const fit = FITS[request](viewport, page);
  return fit === null ? null : clampZoom(fit);
}

/**
 * Screen pixels per page unit in the overlay paint under way — the view's
 * zoom, set as the overlay is cleared. The caret, handles and focus outlines
 * are the pointer's, not the page's: they divide by it to stay one size on
 * screen at every zoom.
 */
let paintZoom = 1;

/** @internal Set by the overlay clear at the start of each paint. */
export function setPaintZoom(zoom: number): void {
  paintZoom = zoom;
}

/**
 * `px` screen pixels, in the page units an overlay draws in. Valid only
 * inside an overlay paint — overlay render handlers included — where the
 * clear has recorded the zoom.
 */
export const screenPixels = (px: number): number => px / paintZoom;
