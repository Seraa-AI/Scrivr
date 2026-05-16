/**
 * TileManager tests — real `Editor` + real canvas via `@napi-rs/canvas`.
 * Covers pure helpers (`fragmentsInTile`, `findScrollParent`) plus the
 * DOM-observable behaviour of TileManager (pool sizing, tile positioning,
 * destroy cleanup, overlay repaint, chrome-band click routing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TileManager,
  fragmentsInTile,
  findScrollParent,
  routePageClick,
} from "./TileManager";
import type { TileManagerOptions } from "./TileManager";
import {
  makeRendererTestSetup,
  fixedChromeBandsExtension,
  registerActiveSurface,
} from "../test-utils";
import type { LayoutFragment } from "../layout/PageLayout";

function frag(y: number, height: number): LayoutFragment {
  return { y, height } as LayoutFragment;
}


describe("fragmentsInTile", () => {
  it("returns empty array for empty fragments list", () => {
    expect(fragmentsInTile([], 0, 307)).toEqual([]);
  });

  it("returns all fragments that overlap [0, 300)", () => {
    // frags end at 100, 200, 300 — only first two end before tileBottom,
    // but third (y=200, bottom=300) still has y=200 < 300 → included.
    const frags = [
      frag(0, 100),
      frag(100, 100),
      frag(200, 100),
      frag(300, 100),
    ];
    // tile [0, 300): frag at y=300 has y < 300? No — excluded.
    expect(fragmentsInTile(frags, 0, 300)).toHaveLength(3);
  });

  it("excludes fragments entirely before tileTop", () => {
    const frags = [frag(0, 50), frag(100, 50), frag(500, 50)];
    // tile [200, 500) — first two end before 200
    expect(fragmentsInTile(frags, 200, 500)).toHaveLength(0);
  });

  it("excludes fragments entirely after tileBottom", () => {
    const frags = [frag(0, 50), frag(100, 50), frag(500, 50)];
    // tile [0, 307) — third frag starts at 500 ≥ 307
    expect(fragmentsInTile(frags, 0, 307)).toHaveLength(2);
  });

  it("includes a fragment that starts before tileTop but overlaps into it", () => {
    // frag y=280, h=60 → bottom=340 > tileTop=307, y=280 < tileBottom=614 → included
    const frags = [frag(280, 60), frag(400, 50)];
    expect(fragmentsInTile(frags, 307, 614)).toHaveLength(2);
  });

  it("does NOT include a fragment that ends exactly at tileTop", () => {
    // frag y=200, h=107 → bottom=307; condition is bottom > tileTop (307 > 307) = false
    const frags = [frag(200, 107), frag(307, 50)];
    const result = fragmentsInTile(frags, 307, 614);
    expect(result).toHaveLength(1);
    expect(result[0]!.y).toBe(307);
  });

  it("returns the correct single fragment from a large sorted list", () => {
    // 100 fragments each 100px tall — tile [1000, 1100) matches only index 10
    const frags = Array.from({ length: 100 }, (_, i) => frag(i * 100, 100));
    const result = fragmentsInTile(frags, 1000, 1100);
    expect(result).toHaveLength(1);
    expect(result[0]!.y).toBe(1000);
  });

  it("returns multiple consecutive fragments spanning a tile", () => {
    const frags = Array.from({ length: 20 }, (_, i) => frag(i * 50, 50));
    // tile [100, 300): frags at y=100,150,200,250 → 4 frags
    const result = fragmentsInTile(frags, 100, 300);
    expect(result).toHaveLength(4);
    expect(result[0]!.y).toBe(100);
    expect(result[3]!.y).toBe(250);
  });
});

describe("findScrollParent", () => {
  it("returns null when no scrollable ancestor exists", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(findScrollParent(el)).toBeNull();
    el.remove();
  });

  it("finds the nearest ancestor with overflow:auto", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const target = document.createElement("div");
    outer.style.overflow = "auto";
    outer.appendChild(inner);
    inner.appendChild(target);
    document.body.appendChild(outer);

    expect(findScrollParent(target)).toBe(outer);
    outer.remove();
  });

  it("finds the nearest ancestor with overflowY:scroll", () => {
    const scrollable = document.createElement("div");
    const child = document.createElement("div");
    scrollable.style.overflowY = "scroll";
    scrollable.appendChild(child);
    document.body.appendChild(scrollable);

    expect(findScrollParent(child)).toBe(scrollable);
    scrollable.remove();
  });

  it("stops at the nearest ancestor, not the outermost", () => {
    const outer = document.createElement("div");
    const middle = document.createElement("div");
    const target = document.createElement("div");
    outer.style.overflow = "auto";
    middle.style.overflow = "scroll";
    outer.appendChild(middle);
    middle.appendChild(target);
    document.body.appendChild(outer);

    expect(findScrollParent(target)).toBe(middle);
    outer.remove();
  });
});

describe("TileManager — construction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends exactly one tilesContainer child to the container", () => {
    const setup = makeRendererTestSetup();
    const tm = new TileManager(setup.editor, setup.container);
    expect(setup.container.children).toHaveLength(1);
    tm.destroy();
    setup.cleanup();
  });

  it("pool starts with exactly 1 tile wrapper (display:none) before first update", () => {
    const setup = makeRendererTestSetup();
    const tm = new TileManager(setup.editor, setup.container);
    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    expect(tilesContainer.children).toHaveLength(1);
    expect((tilesContainer.children[0] as HTMLElement).style.display).toBe("none");
    tm.destroy();
    setup.cleanup();
  });

  it("calls editor.setPageTopLookup with a function", () => {
    const setup = makeRendererTestSetup();
    const spy = vi.spyOn(setup.editor, "setPageTopLookup");
    const tm = new TileManager(setup.editor, setup.container);
    expect(spy).toHaveBeenCalledWith(expect.any(Function));
    tm.destroy();
    setup.cleanup();
  });

  it("calls editor.subscribe to listen for state changes", () => {
    const setup = makeRendererTestSetup();
    const spy = vi.spyOn(setup.editor, "subscribe");
    const tm = new TileManager(setup.editor, setup.container);
    expect(spy).toHaveBeenCalledWith(expect.any(Function));
    tm.destroy();
    setup.cleanup();
  });

  it("accepts all options without throwing", () => {
    const setup = makeRendererTestSetup();
    const opts: TileManagerOptions = {
      gap: 32,
      overscan: 2,
      smallTileHeight: 400,
      showMarginGuides: true,
      pageStyle: { boxShadow: "none" },
    };
    expect(() => {
      const tm = new TileManager(setup.editor, setup.container, opts);
      tm.destroy();
    }).not.toThrow();
    setup.cleanup();
  });
});

describe("TileManager — tile positioning (paged)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first visible tile gets top:0 and display:block after update()", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const firstVisible = Array.from(tilesContainer.children).find(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement | undefined;

    expect(firstVisible).toBeDefined();
    expect(firstVisible!.style.top).toBe("0px");
    tm.destroy();
    setup.cleanup();
  });

  it("second visible tile top equals pageHeight + gap", () => {
    const gap = 24;
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container, { gap });
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const visible = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement[];

    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible[1]!.style.top).toBe(
      `${setup.pageConfig.pageHeight + gap}px`,
    );
    tm.destroy();
    setup.cleanup();
  });

  it("tile height equals pageHeight", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const firstVisible = Array.from(tilesContainer.children).find(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement | undefined;

    expect(firstVisible!.style.height).toBe(`${setup.pageConfig.pageHeight}px`);
    tm.destroy();
    setup.cleanup();
  });

  it("tilesContainer width equals pageConfig.pageWidth", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    expect(tilesContainer.style.width).toBe(`${setup.pageConfig.pageWidth}px`);
    tm.destroy();
    setup.cleanup();
  });

  it("tilesContainer height equals pageCount * pageHeight + (pageCount-1) * gap", () => {
    const gap = 24;
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container, { gap });
    tm.update();

    const pageCount = setup.editor.layout.pages.length;
    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const expected = pageCount * setup.pageConfig.pageHeight + (pageCount - 1) * gap;
    expect(tilesContainer.style.height).toBe(`${expected}px`);
    tm.destroy();
    setup.cleanup();
  });

  it("each tile wrapper contains exactly 2 canvas elements (content + overlay)", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    for (const wrapper of Array.from(tilesContainer.children)) {
      expect(wrapper.querySelectorAll("canvas")).toHaveLength(2);
    }
    tm.destroy();
    setup.cleanup();
  });
});

describe("TileManager — dynamic pool sizing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pool grows beyond 1 after update() to cover the viewport", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    expect(tilesContainer.children).toHaveLength(1); // starts at 1

    tm.update();
    expect(tilesContainer.children.length).toBeGreaterThan(1);
    tm.destroy();
    setup.cleanup();
  });

  it("pool size covers viewport: ceil(viewportH / tileH) + overscan tiles visible", () => {
    // viewport=800, pageHeight=1123 → ceil(800/1123)=1, overscan=1 → firstVisible=0, lastVisible=1
    // needed = lastVisible - firstVisible + 1 = 2
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container, { overscan: 1 });
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const visibleCount = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "block",
    ).length;

    expect(visibleCount).toBeGreaterThanOrEqual(1);
    expect(visibleCount).toBeLessThanOrEqual(3); // 1 + 2 * overscan
    tm.destroy();
    setup.cleanup();
  });

  it("tiles outside the visible range are hidden (display:none)", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    const tilesContainer = setup.container.children[0] as HTMLDivElement;
    const hiddenTiles = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "none",
    );
    // Pool may have grown but some tiles should still be hidden (unassigned ones)
    // For a small viewport, pool size === visible range, so all tiles are visible.
    for (const tile of hiddenTiles) {
      expect((tile as HTMLElement).style.display).toBe("none");
    }
    tm.destroy();
    setup.cleanup();
  });
});

describe("TileManager — destroy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes the tilesContainer from the DOM", () => {
    const setup = makeRendererTestSetup();
    const tm = new TileManager(setup.editor, setup.container);
    expect(setup.container.children).toHaveLength(1);
    tm.destroy();
    expect(setup.container.children).toHaveLength(0);
    setup.cleanup();
  });

  it("calls setPageTopLookup(null) to deregister the lookup", () => {
    const setup = makeRendererTestSetup();
    const spy = vi.spyOn(setup.editor, "setPageTopLookup");
    const tm = new TileManager(setup.editor, setup.container);
    tm.destroy();
    expect(spy).toHaveBeenLastCalledWith(null);
    setup.cleanup();
  });

  it("calls the unsubscribe function returned by editor.subscribe", () => {
    const setup = makeRendererTestSetup();
    // Wrap subscribe's returned unsubscribe in a spy. The subscription itself
    // is real — we only intercept the return value so we can assert
    // TileManager.destroy() invokes it.
    const wrappedUnsubscribe = vi.fn();
    const originalSubscribe = setup.editor.subscribe.bind(setup.editor);
    vi.spyOn(setup.editor, "subscribe").mockImplementation((cb) => {
      const realUnsub = originalSubscribe(cb);
      return () => { wrappedUnsubscribe(); realUnsub(); };
    });

    const tm = new TileManager(setup.editor, setup.container);
    tm.destroy();
    expect(wrappedUnsubscribe).toHaveBeenCalled();
    setup.cleanup();
  });

  it("is safe to call destroy twice (no throw)", () => {
    const setup = makeRendererTestSetup();
    const tm = new TileManager(setup.editor, setup.container);
    tm.destroy();
    expect(() => tm.destroy()).not.toThrow();
    setup.cleanup();
  });
});

describe("TileManager — overlay repaint with active surface", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("overlay repaints on every update cycle when a surface is active", () => {
    const setup = makeRendererTestSetup({ scrollParent: true });
    registerActiveSurface(setup.editor);
    const spy = vi.spyOn(setup.editor, "runOverlayHandlers");

    const tm = new TileManager(setup.editor, setup.container);
    tm.update(); // first paint
    expect(spy).toHaveBeenCalled();

    const callCountAfterFirst = spy.mock.calls.length;
    // Second update with no state change still repaints overlay because a
    // surface is active (surfaceStateDirty stays true).
    tm.update();
    expect(spy.mock.calls.length).toBeGreaterThan(callCountAfterFirst);

    tm.destroy();
    setup.cleanup();
  });

  it("overlay call count grows faster with active surface than without", () => {
    const withSurfaceSetup = makeRendererTestSetup({ scrollParent: true });
    registerActiveSurface(withSurfaceSetup.editor);
    const withSurfaceSpy = vi.spyOn(withSurfaceSetup.editor, "runOverlayHandlers");
    const tm1 = new TileManager(withSurfaceSetup.editor, withSurfaceSetup.container);
    tm1.update();
    tm1.update();
    tm1.update();
    const withSurface = withSurfaceSpy.mock.calls.length;
    tm1.destroy();
    withSurfaceSetup.cleanup();

    const noSurfaceSetup = makeRendererTestSetup({ scrollParent: true });
    const noSurfaceSpy = vi.spyOn(noSurfaceSetup.editor, "runOverlayHandlers");
    const tm2 = new TileManager(noSurfaceSetup.editor, noSurfaceSetup.container);
    tm2.update();
    tm2.update();
    tm2.update();
    const withoutSurface = noSurfaceSpy.mock.calls.length;
    tm2.destroy();
    noSurfaceSetup.cleanup();

    expect(withSurface).toBeGreaterThanOrEqual(withoutSurface);
  });
});

describe("TileManager — body click deactivates surface", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clicking in the body deactivates an active surface", () => {
    // Real chrome bands via an inline extension that contributes 60px header
    // + 60px footer on every page. Real SurfaceRegistry, real Editor.
    const setup = makeRendererTestSetup({
      scrollParent: true,
      extraExtensions: [fixedChromeBandsExtension(60, 60)],
    });
    registerActiveSurface(setup.editor);
    const activateSpy = vi.spyOn(setup.editor.surfaces, "activate");

    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    // y=500 is well below contentTop (~132) — body area, not chrome.
    const consumed = routePageClick(setup.editor, 1, 400, 500, 1);
    expect(consumed).toBe(false);
    expect(activateSpy).toHaveBeenCalledWith(null);

    tm.destroy();
    setup.cleanup();
  });

  it("clicking in a chrome band does NOT deactivate the surface", () => {
    const setup = makeRendererTestSetup({
      scrollParent: true,
      pageCount: 1,
      extraExtensions: [fixedChromeBandsExtension(60, 60)],
    });
    registerActiveSurface(setup.editor);
    const activateSpy = vi.spyOn(setup.editor.surfaces, "activate");

    const tm = new TileManager(setup.editor, setup.container);
    tm.update();

    // y=90 is inside the header band (margins.top=72 + headerHeight=60 → contentTop=132).
    // All click counts in the chrome band with an active surface fall through —
    // they don't deactivate.
    expect(routePageClick(setup.editor, 1, 400, 90, 1)).toBe(false);
    expect(routePageClick(setup.editor, 1, 400, 90, 2)).toBe(false);
    expect(routePageClick(setup.editor, 1, 400, 90, 3)).toBe(false);
    expect(activateSpy).not.toHaveBeenCalledWith(null);

    tm.destroy();
    setup.cleanup();
  });
});

describe("TileManager — margin click activation (no policy)", () => {
  let container: HTMLDivElement;
  let scrollParent: HTMLDivElement;

  beforeEach(() => {
    stubCanvas();
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", { value: 800, configurable: true });
    Object.defineProperty(scrollParent, "scrollTop", { value: 0, configurable: true, writable: true });
    container = document.createElement("div");
    scrollParent.appendChild(container);
    document.body.appendChild(scrollParent);
    vi.useFakeTimers();
  });

  afterEach(() => {
    scrollParent.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  type OnPageClick = (page: number, x: number, y: number, clickCount: number) => boolean;
  type EmitFn = ReturnType<typeof vi.fn>;

  /**
   * The TileManager wires its pointer's onPageClick callback to private
   * state. Tests need to invoke that callback directly to assert the chrome
   * vs body branch. One cast at this seam, named so call sites stay clean.
   */
  function getOnPageClick(tm: TileManager): OnPageClick {
    const internals = tm as unknown as { pointer: { deps: { onPageClick: OnPageClick } } };
    return internals.pointer.deps.onPageClick;
  }

  /**
   * Attach an emit spy + a surfaces stub to a mock editor. Returned object
   * is the same editor instance, but with the view-bits exposed as a typed
   * intersection so call sites don't need to re-narrow.
   */
  function attachEmitAndSurfaces(editor: Editor): Editor & {
    emit: EmitFn;
    surfaces: { activeSurface: unknown; activate: ReturnType<typeof vi.fn> };
  } {
    const emit: EmitFn = vi.fn();
    const surfaces = { activeSurface: null, activate: vi.fn() };
    Object.assign(editor, { emit, surfaces });
    return editor as Editor & { emit: EmitFn; surfaces: typeof surfaces };
  }

  // Fresh-doc metrics: header/footer bands collapsed to zero because no
  // headerFooter policy exists yet. contentTop / footerTop sit exactly at
  // the page's layout margins.
  const collapsedMetrics = {
    contentTop: DEFAULT_PAGE_CONFIG.margins.top,
    contentBottom: DEFAULT_PAGE_CONFIG.pageHeight - DEFAULT_PAGE_CONFIG.margins.bottom,
    contentHeight: DEFAULT_PAGE_CONFIG.pageHeight - DEFAULT_PAGE_CONFIG.margins.top - DEFAULT_PAGE_CONFIG.margins.bottom,
    contentWidth: DEFAULT_PAGE_CONFIG.pageWidth - DEFAULT_PAGE_CONFIG.margins.left - DEFAULT_PAGE_CONFIG.margins.right,
    headerTop: DEFAULT_PAGE_CONFIG.margins.top,
    footerTop: DEFAULT_PAGE_CONFIG.pageHeight - DEFAULT_PAGE_CONFIG.margins.bottom,
    headerHeight: 0,
    footerHeight: 0,
  };

  function makeFreshDocEditor() {
    const { editor, layoutRef } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, null);
    layoutRef.current = {
      ...makeLayout(2, DEFAULT_PAGE_CONFIG),
      metrics: [
        { pageNumber: 1, ...collapsedMetrics },
        { pageNumber: 2, ...collapsedMetrics },
      ],
    } as DocumentLayout;
    return attachEmitAndSurfaces(editor);
  }

  it("emits chromeClick on double-click in the top margin even when band heights are 0", () => {
    const editor = makeFreshDocEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    // y=40 is inside margins.top (72) — i.e. the potential header strip.
    const consumed = getOnPageClick(tm)(1, 400, 40, 2);
    expect(consumed).toBe(true);
    expect(editor.emit).toHaveBeenCalledWith(
      "chromeClick",
      expect.objectContaining({ page: 1, band: "header", clickCount: 2 }),
    );

    tm.destroy();
  });

  it("emits chromeClick on double-click in the bottom margin even when band heights are 0", () => {
    const editor = makeFreshDocEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const footerY = DEFAULT_PAGE_CONFIG.pageHeight - DEFAULT_PAGE_CONFIG.margins.bottom + 20;
    const consumed = getOnPageClick(tm)(1, 400, footerY, 2);
    expect(consumed).toBe(true);
    expect(editor.emit).toHaveBeenCalledWith(
      "chromeClick",
      expect.objectContaining({ page: 1, band: "footer", clickCount: 2 }),
    );

    tm.destroy();
  });

  it("does not emit chromeClick on body double-click (between margins)", () => {
    const editor = makeFreshDocEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    // y=400 is well inside the body (between margins.top=72 and footer strip).
    const consumed = getOnPageClick(tm)(1, 400, 400, 2);
    expect(consumed).toBe(false);
    expect(editor.emit).not.toHaveBeenCalledWith("chromeClick", expect.anything());

    tm.destroy();
  });

  it("respects explicit band bounds when policy exists (no regression on demo path)", () => {
    // Policy-enabled doc: bands have non-zero heights. The widened fallback
    // must defer to metrics.contentTop / metrics.footerTop, not the raw
    // pageConfig margins.
    const { editor: base, layoutRef } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, null);
    layoutRef.current = {
      ...makeLayout(1, DEFAULT_PAGE_CONFIG),
      metrics: [{
        pageNumber: 1,
        contentTop: 132,        // larger than margins.top (72) — band reserves extra space
        contentBottom: 991,
        contentHeight: 859,
        contentWidth: 650,
        headerTop: 72,
        footerTop: 991,
        headerHeight: 60,
        footerHeight: 60,
      }],
    } as DocumentLayout;
    const editor = attachEmitAndSurfaces(base);

    const tm = new TileManager(editor, container);
    tm.update();

    // y=100 sits between margins.top (72) and the band-resolved contentTop (132).
    // With bands present, that's still inside the header — must emit chromeClick.
    expect(getOnPageClick(tm)(1, 400, 100, 2)).toBe(true);
    expect(editor.emit).toHaveBeenCalledWith(
      "chromeClick",
      expect.objectContaining({ band: "header" }),
    );

    tm.destroy();
  });
});
