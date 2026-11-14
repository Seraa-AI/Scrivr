/**
 * Zoom is a view scale: the column of pages is shown `zoom` times its size,
 * painted at that resolution, and everything a host positions over it follows
 * — while the layout and the document stay the same.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TileManager } from "./TileManager";
import { makeRendererTestSetup, type RendererTestSetup } from "../test-utils";

const GAP = 24;

/** A wheel event over the editor; happy-dom drops the modifier keys from the init, so they are set after. */
function wheel(target: HTMLElement, { ctrlKey = false, metaKey = false, ...init }: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
  Object.defineProperty(event, "metaKey", { value: metaKey });
  target.dispatchEvent(event);
  return event;
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
    Object.defineProperty(view, "clientWidth", { value: setup.pageConfig.pageWidth / 2, configurable: true });
    setup.editor.setZoom("fit-width");
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    expect(setup.editor.zoom).toBe(0.5);

    Object.defineProperty(view, "clientWidth", { value: setup.pageConfig.pageWidth * 1.25, configurable: true });
    setup.editor.refitZoom();
    expect(setup.editor.zoom).toBe(1.25);
    expect(setup.editor.zoomRequest).toBe("fit-width");
  });

  it("keeps a factor through a resize", () => {
    const view = setup.scrollParent;
    if (!view) throw new Error("no view");
    setup.editor.setZoom(1.5);
    tm = new TileManager(setup.editor, setup.container);
    tm.update();
    Object.defineProperty(view, "clientWidth", { value: 300, configurable: true });
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
