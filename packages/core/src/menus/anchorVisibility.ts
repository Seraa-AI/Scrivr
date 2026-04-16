/**
 * Anchor visibility helper used by all popover / bubble-menu controllers.
 *
 * A position:fixed popover portal'd to the document body has no overflow
 * clipping of its own — once it's positioned, it renders over anything
 * outside the editor's scroll container (app toolbars, sidebars, headers)
 * until the next onHide. The controllers call this to decide whether to
 * show the popover at all: if the anchor rect sits entirely outside the
 * scrollable content area, we hide it so it doesn't visually leak onto
 * surrounding chrome.
 *
 * This matches the Google Docs / Word convention where anchor-bound UI
 * disappears once its target scrolls out of the visible page area.
 */
export function isAnchorInsideContainer(
  anchor: DOMRect,
  container: DOMRect | null,
): boolean {
  // No container known (SSR, unmounted, ServerEditor) — always visible.
  if (!container) return true;
  // Entirely above the container's top edge (scrolled up past the toolbar).
  if (anchor.bottom <= container.top) return false;
  // Entirely below the container's bottom edge (scrolled past the viewport).
  if (anchor.top >= container.bottom) return false;
  return true;
}
