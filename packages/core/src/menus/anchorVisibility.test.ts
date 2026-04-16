/**
 * Regression guard for the "popover renders over the app toolbar" bug.
 *
 * The anchor visibility check must return false when the anchor is clipped
 * above the scroll container's top (scrolled up past the toolbar) or below
 * its bottom. Partial overlap counts as visible — matching Google Docs.
 */
import { describe, it, expect } from "vitest";
import { isAnchorInsideContainer } from "./anchorVisibility";

function rect(top: number, bottom: number): DOMRect {
  return new DOMRect(0, top, 100, bottom - top);
}

const CONTAINER = rect(100, 800); // 700px tall visible region

describe("isAnchorInsideContainer", () => {
  it("returns true when no container is known (SSR / ServerEditor)", () => {
    expect(isAnchorInsideContainer(rect(0, 50), null)).toBe(true);
  });

  it("fully inside → visible", () => {
    expect(isAnchorInsideContainer(rect(200, 250), CONTAINER)).toBe(true);
  });

  it("entirely above container top → hidden", () => {
    expect(isAnchorInsideContainer(rect(0, 90), CONTAINER)).toBe(false);
  });

  it("entirely below container bottom → hidden", () => {
    expect(isAnchorInsideContainer(rect(900, 950), CONTAINER)).toBe(false);
  });

  it("touching the top edge (anchor.bottom === container.top) → hidden", () => {
    // Exactly flush is treated as out-of-view — the anchor's visible area
    // is zero pixels, same as fully above.
    expect(isAnchorInsideContainer(rect(50, 100), CONTAINER)).toBe(false);
  });

  it("partially above top → visible (only ~half clipped)", () => {
    expect(isAnchorInsideContainer(rect(50, 150), CONTAINER)).toBe(true);
  });

  it("partially below bottom → visible", () => {
    expect(isAnchorInsideContainer(rect(780, 820), CONTAINER)).toBe(true);
  });
});
