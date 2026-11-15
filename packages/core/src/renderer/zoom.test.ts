import { describe, expect, it, vi } from "vitest";
// Through the package's barrel: these are what a host imports.
import { MAX_ZOOM, MIN_ZOOM, resolveZoom, screenPixels, clearOverlay } from "../index";
import { createTestEditor } from "../test-utils";

const a4 = { pageWidth: 794, pageHeight: 1123 };

describe("resolveZoom", () => {
  it("takes a factor as given, within Word's 10%–500%", () => {
    expect(resolveZoom(1.25, null, a4)).toBe(1.25);
    expect(resolveZoom(0.01, null, a4)).toBe(MIN_ZOOM);
    expect(resolveZoom(12, null, a4)).toBe(MAX_ZOOM);
    expect(resolveZoom(Number.POSITIVE_INFINITY, null, a4)).toBe(MAX_ZOOM);
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.1, 5]);
  });

  it("shows 100% for what is no zoom — NaN, or a request plain JavaScript made up", () => {
    expect(resolveZoom(Number.NaN, null, a4)).toBe(1);
    expect(Reflect.apply(resolveZoom, undefined, ["fit-height", { width: 397, height: 600 }, a4])).toBe(1);
  });

  it("fits the page's width to the view, larger or smaller, whatever the view's height", () => {
    expect(resolveZoom("fit-width", { width: 397, height: 600 }, a4)).toBe(0.5);
    expect(resolveZoom("fit-width", { width: 1588, height: 600 }, a4)).toBe(2);
    expect(resolveZoom("fit-width", { width: 397, height: 0 }, a4)).toBe(0.5);
  });

  it("fits the whole page into the view, by whichever side is tighter", () => {
    expect(resolveZoom("fit-page", { width: 1588, height: 561.5 }, a4)).toBe(0.5);
    expect(resolveZoom("fit-page", { width: 397, height: 5000 }, a4)).toBe(0.5);
  });

  it("finds no fit while there is no view to measure, and never fits past the range", () => {
    expect(resolveZoom("fit-width", null, a4)).toBeNull();
    expect(resolveZoom("fit-width", { width: 0, height: 0 }, a4)).toBeNull();
    expect(resolveZoom("fit-page", { width: 397, height: 0 }, a4)).toBeNull();
    expect(resolveZoom("fit-width", { width: 40, height: 600 }, a4)).toBe(MIN_ZOOM);
    expect(resolveZoom("fit-page", { width: 99999, height: 99999 }, a4)).toBe(MAX_ZOOM);
  });
});

describe("an overlay handler", () => {
  it("sizes its own furniture in screen pixels, from the zoom the paint was cleared at", () => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    clearOverlay(ctx, 100, 100, 4, 2);
    expect(screenPixels(10)).toBe(5);
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

  it("keeps its factor while its view is hidden, and fits again when it shows", () => {
    const editor = createTestEditor({ zoom: "fit-width" });
    let view = { width: editor.pageConfig.pageWidth * 1.5, height: 800 };
    editor.setViewportSizeLookup(() => view);
    editor.refitZoom();
    expect(editor.zoom).toBe(1.5);

    view = { width: 0, height: 0 };
    editor.refitZoom();
    expect(editor.zoom).toBe(1.5);

    view = { width: editor.pageConfig.pageWidth * 0.75, height: 800 };
    editor.refitZoom();
    expect(editor.zoom).toBe(0.75);
    editor.destroy();
  });

  it("tells its listeners when what was asked changes, even to a request showing the same factor", () => {
    const editor = createTestEditor({ zoom: 1 });
    editor.setViewportSizeLookup(() => ({ width: editor.pageConfig.pageWidth, height: 800 }));
    const zoom = vi.fn();
    const viewport = vi.fn();
    editor.on("zoom", zoom);
    editor.on("viewport", viewport);

    // Fit width here is 100% too: nothing on screen moves, but the fit now follows the view.
    editor.setZoom("fit-width");
    expect(zoom).toHaveBeenCalledWith({ zoom: 1, previous: 1, request: "fit-width" });
    expect(viewport).not.toHaveBeenCalled();

    editor.setZoom("fit-width");
    expect(zoom).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});
