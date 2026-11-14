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

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/**
 * The factor `request` shows a page of `page` size at, in a view of
 * `viewport`. A fit with no view to fit yet — not mounted, or not laid out —
 * shows 100%; what is no number shows 100% too.
 */
export function resolveZoom(request: ZoomRequest, viewport: ZoomViewport | null, page: ZoomViewport): number {
  if (typeof request === "number") return Number.isFinite(request) ? clampZoom(request) : 1;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return 1;
  const toWidth = viewport.width / page.width;
  return clampZoom(request === "fit-width" ? toWidth : Math.min(toWidth, viewport.height / page.height));
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

/** `px` screen pixels, in the page units an overlay draws in. */
export const screenPixels = (px: number): number => px / paintZoom;
