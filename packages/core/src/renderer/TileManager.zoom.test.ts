/**
 * Zoom is a view scale: the column of pages is shown `zoom` times its size,
 * painted at that resolution, and everything a host positions over it follows
 * — while the layout and the document stay the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TileManager } from "./TileManager";
import { MAX_CANVAS_PIXELS } from "./canvas";
import { MAX_ZOOM } from "./zoom";
import { defaultPageConfig, defaultPagelessConfig } from "../layout/PageLayout";
import { createTestEditor, makeRendererTestSetup, type RendererTestSetup } from "../test-utils";

const GAP = 24;

/** A wheel event over the editor; happy-dom drops the modifier keys from the init, so they are set after. */
function wheel(target: HTMLElement, { ctrlKey = false, metaKey = false, ...init }: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
  Object.defineProperty(event, "metaKey", { value: metaKey });
  target.dispatchEvent(event);
  return event;
}

/** Gives the view a width with no scrollbar; happy-dom lays nothing out. */
function viewWidth(view: HTMLElement, width: number): void {
  Object.defineProperty(view, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(view, "clientWidth", { value: width, configurable: true });
}

function shown(setup: RendererTestSetup): HTMLElement[] {
  const tiles = setup.container.children[0]!;
  return Array.from(tiles.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.style.display === "block");
}

describe("TileManager at a zoom", () => {
  let setup: RendererTestSetup;
  let tm: TileManager;

  beforeEach(() => {
    vi.useFakeTimers();
    setup = makeRendererTestSetup({ scrollParent: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    tm.destroy();
    setup.cleanup();
    vi.useRealTimers();
  });

  it("shows every page, and the gap between them, at the zoom", () => {
    setup.editor.setZoom(2);
    tm = new TileManager(setup.editor, setup.container, { gap: GAP });
    tm.update();

    const { pageWidth, pageHeight } = setup.pageConfig;
    const column = setup.container.children[0];
    if (!(column instanceof HTMLElement)) throw new Error("no column");
    const pages = setup.editor.layout.pages.length;
    expect(column.style.width).toBe(`${pageWidth * 2}px`);
    expect(column.style.height).toBe(`${(pages * pageHeight + (pages - 1) * GAP) * 2}px`);
    const [first, second] = shown(setup);
    expect(second?.style.top).toBe(`${(pageHeight + GAP) * 2}px`);
    expect(first?.style.height).toBe(`${pageHeight * 2}px`);
  });

  it("paints each page at the zoom's resolution, never stretching a smaller one", () => {
    setup.editor.setZoom(1.5);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const canvas = shown(setup)[0]?.querySelector("canvas");
    if (!canvas) throw new Error("no canvas");
    const { pageWidth } = setup.pageConfig;
    expect(canvas.style.width).toBe(`${pageWidth * 1.5}px`);
    expect(canvas.width).toBe(Math.round(pageWidth * 1.5 * (window.devicePixelRatio || 1)));
  });

  it.each([
    ["a page", defaultPageConfig],
    ["a pageless tile", defaultPagelessConfig],
  ])("never sizes %s past what a browser will paint, however far it zooms", (_, pageConfig) => {
    vi.stubGlobal("devicePixelRatio", 3);
    setup.cleanup();
    setup = makeRendererTestSetup({ scrollParent: true, pageConfig });
    setup.editor.setZoom(MAX_ZOOM);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const canvases = shown(setup).flatMap((tile) => Array.from(tile.querySelectorAll("canvas")));
    expect(canvases.length).toBeGreaterThan(0);
    for (const canvas of canvases) {
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      // Still shown at the zoom: the browser stretches the capped bitmap.
      expect(canvas.style.width).toBe(`${pageConfig.pageWidth * MAX_ZOOM}px`);
    }
  });

  it("places what a host anchors to the document at the zoom, from the page's corner", () => {
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    const at100 = setup.editor.getViewportRect(5, 5);
    const corner = setup.editor.getPageScreenPosition(1);
    setup.editor.setZoom(2);
    const at200 = setup.editor.getViewportRect(5, 5);

    if (!at100 || !at200 || !corner) throw new Error("no rect");
    expect(at200.left - corner.screenLeft).toBeCloseTo((at100.left - corner.screenLeft) * 2, 6);
    expect(at200.top - corner.screenTop).toBeCloseTo((at100.top - corner.screenTop) * 2, 6);
    expect(at200.height).toBeCloseTo(at100.height * 2, 6);
  });

  it.each([0.5, 1, 2.37])("puts the caret where a click lands, at %s", (zoom) => {
    setup.editor.setZoom(zoom);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    const target = 4; // in the first page's text, on screen at every zoom here
    const rect = setup.editor.getViewportRect(target, target);
    const canvas = shown(setup)[0]?.querySelector("canvas");
    if (!rect || !canvas) throw new Error("not on screen");

    const at = { clientX: rect.left, clientY: rect.top + rect.height / 2, bubbles: true, pointerId: 1, button: 0 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", at));
    document.dispatchEvent(new PointerEvent("pointerup", at));

    expect(setup.editor.getState().selection.head).toBe(target);
  });

  it("keeps the hidden input over the caret as the zoom changes, where the IME bar and the browser look for it", () => {
    setup.editor.mount(setup.container);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    setup.editor.selection.moveCursorTo(4);
    setup.editor.syncInputBridge(); // over the caret at 100%, as after any keystroke
    const textarea = setup.container.querySelector("textarea");
    if (!textarea) throw new Error("no input");
    const at100 = textarea.style.left;

    setup.editor.setZoom(2);

    const caret = setup.editor.getViewportRect(4, 4);
    if (!caret) throw new Error("no caret");
    expect(textarea.style.left).not.toBe(at100);
    expect(parseFloat(textarea.style.left)).toBeCloseTo(caret.left, 3);
    expect(parseFloat(textarea.style.top)).toBeCloseTo(caret.top, 3);
    expect(parseFloat(textarea.style.height)).toBeCloseTo(caret.height, 3);
  });

  it("changes nothing but the view: the layout is the one it was", () => {
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    const layout = setup.editor.layout;
    setup.editor.setZoom(3);
    tm.update();

    expect(setup.editor.layout).toBe(layout);
  });

  it("fits the page's width to its view, and fits again when the view resizes", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    viewWidth(view, setup.pageConfig.pageWidth / 2);
    setup.editor.setZoom("fit-width");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    expect(setup.editor.zoom).toBe(0.5);

    viewWidth(view, setup.pageConfig.pageWidth * 1.25);
    setup.editor.refitZoom();
    expect(setup.editor.zoom).toBe(1.25);
    expect(setup.editor.zoomRequest).toBe("fit-width");
  });

  it("settles a fit when a scrollbar comes and goes, rather than refitting forever", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    const { pageWidth } = setup.pageConfig;
    const SCROLLBAR = 15;
    const scrollbar = (present: boolean) => {
      Object.defineProperty(view, "offsetWidth", { value: pageWidth, configurable: true });
      Object.defineProperty(view, "clientWidth", { value: present ? pageWidth - SCROLLBAR : pageWidth, configurable: true });
    };
    scrollbar(false);
    setup.editor.setZoom("fit-width");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    expect(setup.editor.zoom).toBe(1);

    // The page grew past the view: a classic scrollbar takes its width…
    scrollbar(true);
    setup.editor.refitZoom();
    const fitted = setup.editor.zoom;
    expect(fitted).toBeCloseTo((pageWidth - SCROLLBAR) / pageWidth, 6);

    // …the smaller page no longer needs it, and it goes. The fit stays put.
    scrollbar(false);
    setup.editor.refitZoom();
    expect(setup.editor.zoom).toBe(fitted);
  });

  it("forgets a scrollbar once the view is resized, so a fit fills the new width", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    const { pageWidth } = setup.pageConfig;
    Object.defineProperty(view, "offsetWidth", { value: pageWidth, configurable: true });
    Object.defineProperty(view, "clientWidth", { value: pageWidth - 15, configurable: true });
    setup.editor.setZoom("fit-width");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();

    // Wider, and no scrollbar now: say the browser zoomed out.
    viewWidth(view, pageWidth * 2);
    setup.editor.refitZoom();
    expect(setup.editor.zoom).toBe(2);
  });

  it("keeps a factor through a resize", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    setup.editor.setZoom(1.5);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    viewWidth(view, 300);
    setup.editor.refitZoom();

    expect(setup.editor.zoom).toBe(1.5);
  });

  it("keeps the reader's place: the line at the top of the view stays at the top", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    // happy-dom lays nothing out: the column's top is where scrolling put it.
    const column = setup.container.children[0];
    if (!(column instanceof HTMLElement)) throw new Error("no column");
    vi.spyOn(column, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, -view.scrollTop, 0, 0));
    view.scrollTop = 1000;

    setup.editor.setZoom(2);

    expect(view.scrollTop).toBe(2000);
  });

  it("never shows a blank view while the zoom changes: each page is redrawn at its new size at once", async () => {
    const overlay = await import("./OverlayRenderer");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    const before = shown(setup).length;
    const clearOverlay = vi.spyOn(overlay, "clearOverlay");

    // A resize refits a fit before the browser paints, with no frame between.
    setup.editor.setZoom(2);

    const pages = shown(setup);
    expect(pages.length).toBeGreaterThanOrEqual(Math.min(before, 1));
    const { pageWidth } = setup.pageConfig;
    for (const page of pages) {
      expect(page.style.height).toBe(`${setup.pageConfig.pageHeight * 2}px`);
      expect(page.querySelector("canvas")?.style.width).toBe(`${pageWidth * 2}px`);
    }
    // The overlay, cleared by its resize, draws the caret again too.
    expect(clearOverlay.mock.calls.length).toBeGreaterThanOrEqual(pages.length);
    clearOverlay.mockRestore();
  });

  it("zooms about the pointer on Ctrl/Cmd + wheel or a pinch, and scrolls on a plain wheel", () => {
    tm = new TileManager(setup.editor, setup.container);
    tm.update();

    expect(wheel(setup.container, { deltaY: -100 }).defaultPrevented).toBe(false);
    expect(setup.editor.zoom).toBe(1);

    expect(wheel(setup.container, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(setup.editor.zoom).toBeGreaterThan(1);
    const zoomedIn = setup.editor.zoom;
    wheel(setup.container, { deltaY: 100, metaKey: true });
    expect(setup.editor.zoom).toBeCloseTo(1, 6);
    expect(zoomedIn).toBeCloseTo(Math.exp(0.2), 6);
  });

  it("zooms on Ctrl/Cmd + wheel anywhere in the scrolling view, the gutter beside the page too", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();

    expect(wheel(view, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(setup.editor.zoom).toBeGreaterThan(1);
  });

  it("hears the gutter once a scrolling view appears around an editor mounted before it", () => {
    setup.cleanup();
    setup = makeRendererTestSetup();
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    const view = document.createElement("div");
    view.style.overflowY = "auto";
    document.body.appendChild(view);
    view.appendChild(setup.container);
    tm.update();

    expect(wheel(view, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(setup.editor.zoom).toBeGreaterThan(1);
    view.remove();
  });

  it("zooms only the editor under the pointer when two share a scrolling view", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    const otherContainer = document.createElement("div");
    view.appendChild(otherContainer);
    const other = createTestEditor({ pageConfig: setup.pageConfig });
    const otherTm = new TileManager(other, otherContainer);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    otherTm.update();

    wheel(setup.container, { deltaY: -100, ctrlKey: true });
    expect(setup.editor.zoom).toBeGreaterThan(1);
    expect(other.zoom).toBe(1);

    // Over the gutter there is no telling which: the browser keeps the gesture.
    expect(wheel(view, { deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(false);
    otherTm.destroy();
    other.destroy();
  });

  it("zooms as far for a wheel that counts in lines, as Firefox's does, as for one that counts in pixels", () => {
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    wheel(setup.container, { deltaY: -100, ctrlKey: true });
    const byPixels = setup.editor.zoom;
    setup.editor.setZoom(1);
    wheel(setup.container, { deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE, ctrlKey: true });

    expect(setup.editor.zoom).toBeCloseTo(byPixels, 6);
  });

  it("keeps a fit through a sideways Ctrl/Cmd + wheel, which asks for no zoom", () => {
    setup.editor.setZoom("fit-width");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    wheel(setup.container, { deltaX: 40, deltaY: 0, ctrlKey: true });

    expect(setup.editor.zoomRequest).toBe("fit-width");
  });

  it("leaves the wheel to the browser when the host turns the gesture off", () => {
    tm = new TileManager(setup.editor, setup.container, { zoomGestures: false });
    tm.update();
    const event = wheel(setup.container, { deltaY: -100, ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(setup.editor.zoom).toBe(1);
  });

  it("tells anchored UI to follow when the zoom changes", () => {
    tm = new TileManager(setup.editor, setup.container);
    const zoom = vi.fn();
    const viewport = vi.fn();
    setup.editor.on("zoom", zoom);
    setup.editor.on("viewport", viewport);
    setup.editor.setZoom(0.75);
    setup.editor.setZoom(0.75);

    expect(zoom).toHaveBeenCalledTimes(1);
    expect(zoom).toHaveBeenCalledWith({ zoom: 0.75, previous: 1, request: 0.75 });
    expect(viewport).toHaveBeenCalledTimes(1);
  });
});
