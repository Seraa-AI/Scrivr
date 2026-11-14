import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, resolveZoom } from "./zoom";
import { createTestEditor } from "../test-utils";

const a4 = { width: 794, height: 1123 };

describe("resolveZoom", () => {
  it("takes a factor as given, within Word's 10%–500%", () => {
    expect(resolveZoom(1.25, null, a4)).toBe(1.25);
    expect(resolveZoom(0.01, null, a4)).toBe(MIN_ZOOM);
    expect(resolveZoom(12, null, a4)).toBe(MAX_ZOOM);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.1, 5]);
  });

  it("reads no factor from what is no number", () => {
    expect(resolveZoom(Number.NaN, null, a4)).toBe(1);
    expect(resolveZoom(Number.POSITIVE_INFINITY, null, a4)).toBe(1);
  });

  it("fits the page's width to the view, larger or smaller", () => {
    expect(resolveZoom("fit-width", { width: 397, height: 600 }, a4)).toBe(0.5);
    expect(resolveZoom("fit-width", { width: 1588, height: 600 }, a4)).toBe(2);
  });

  it("fits the whole page into the view, by whichever side is tighter", () => {
    expect(resolveZoom("fit-page", { width: 1588, height: 561.5 }, a4)).toBe(0.5);
    expect(resolveZoom("fit-page", { width: 397, height: 5000 }, a4)).toBe(0.5);
  });

  it("shows a fit at 100% while there is no view to fit, and never past the range", () => {
    expect(resolveZoom("fit-width", null, a4)).toBe(1);
    expect(resolveZoom("fit-width", { width: 0, height: 0 }, a4)).toBe(1);
    expect(resolveZoom("fit-width", { width: 40, height: 600 }, a4)).toBe(MIN_ZOOM);
    expect(resolveZoom("fit-page", { width: 99999, height: 99999 }, a4)).toBe(MAX_ZOOM);
  });
});

describe("an editor's zoom", () => {
  it("opens at the factor it is given, and at 100% for a fit until a view mounts", () => {
    const scaled = createTestEditor({ zoom: 1.5 });
    const fitted = createTestEditor({ zoom: "fit-page" });

    expect([scaled.zoom, fitted.zoom, fitted.zoomRequest]).toEqual([1.5, 1, "fit-page"]);
    scaled.destroy();
    fitted.destroy();
  });
});
