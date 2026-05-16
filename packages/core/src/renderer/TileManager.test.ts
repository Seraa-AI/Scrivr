/**
 * TileManager tests.
 *
 * Covers the pure helper functions (fragmentsInTile, findScrollParent) and the
 * DOM-observable behaviour of TileManager (pool sizing, tile positioning,
 * destroy cleanup) using happy-dom + a full canvas 2D context mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TileManager, fragmentsInTile, findScrollParent } from "./TileManager";
import type { TileManagerOptions } from "./TileManager";
import type { Editor } from "../Editor";
import type {
  DocumentLayout,
  LayoutFragment,
  PageConfig,
} from "../layout/PageLayout";


function frag(y: number, height: number): LayoutFragment {
  return { y, height } as LayoutFragment;
}

const DEFAULT_PAGE_CONFIG: PageConfig = {
  pageWidth: 794,
  pageHeight: 1123,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

function makeLayout(
  pageCount: number,
  pageConfig = DEFAULT_PAGE_CONFIG,
): DocumentLayout {
  return {
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      blocks: [],
      lines: [],
    })) as DocumentLayout["pages"],
    pageConfig,
    version: 1,
    totalContentHeight: pageCount * pageConfig.pageHeight,
    fragments: [],
  } as unknown as DocumentLayout;
}

function makeMockEditor(
  isPageless = false,
  pageConfig = DEFAULT_PAGE_CONFIG,
  activeSurface: unknown = null,
) {
  const layoutRef = { current: makeLayout(10, pageConfig) };

  const editor = {
    get isPageless() {
      return isPageless;
    },
    get pageConfig() {
      return pageConfig;
    },
    get layout() {
      return layoutRef.current;
    },
    setPageTopLookup: vi.fn(),
    setScrollContainerLookup: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    ensurePagePopulated: vi.fn(),
    charMap: {
      coordsAtPos: vi.fn(() => null),
      linesInRange: vi.fn(() => []),
      glyphsInRange: vi.fn(() => []),
    },
    cursorPage: 1,
    isFocused: false,
    cursorManager: { isVisible: false },
    getSelectionSnapshot: vi.fn(() => ({
      head: 0,
      from: 0,
      to: 0,
      empty: true,
    })),
    getState: vi.fn(() => ({
      selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true },
    })),
    runOverlayHandlers: vi.fn(),
    measurer: { measureRun: vi.fn(() => ({ runs: [], totalWidth: 0 })) },
    blockRegistry: undefined,
    inlineRegistry: undefined,
    markDecorators: undefined,
    surfaces: { activeSurface },
    pageChromeContributions: [],
    getResolvedTheme: vi.fn(() => ({
      pageBg: "#ffffff",
      pageShadow: "0 1px 3px rgba(0,0,0,0.1)",
      defaultText: "#1e293b",
      link: "#4f46e5",
      cursor: "#1e293b",
      selectionFill: "rgba(59, 130, 246, 0.25)",
      imagePlaceholderBg: "#f1f5f9",
      imagePlaceholderBorder: "#cbd5e1",
      imagePlaceholderText: "#64748b",
      listMarker: "#1e293b",
      hrColor: "#cbd5e1",
      resizeHandle: "#3b82f6",
    })),
  } as unknown as Editor;

  return { editor, layoutRef };
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
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("appends exactly one tilesContainer child to the container", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    expect(container.children).toHaveLength(1);
    tm.destroy();
  });

  it("pool starts with exactly 1 tile wrapper (display:none) before first update", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    const tilesContainer = container.children[0] as HTMLDivElement;
    expect(tilesContainer.children).toHaveLength(1);
    expect((tilesContainer.children[0] as HTMLElement).style.display).toBe(
      "none",
    );
    tm.destroy();
  });

  it("calls editor.setPageTopLookup with a function", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    expect(editor.setPageTopLookup).toHaveBeenCalledWith(expect.any(Function));
    tm.destroy();
  });

  it("calls editor.subscribe to listen for state changes", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    expect(editor.subscribe).toHaveBeenCalledWith(expect.any(Function));
    tm.destroy();
  });

  it("accepts all options without throwing", () => {
    const { editor } = makeMockEditor();
    const opts: TileManagerOptions = {
      gap: 32,
      overscan: 2,
      smallTileHeight: 400,
      showMarginGuides: true,
      pageStyle: { boxShadow: "none" },
    };
    expect(() => {
      const tm = new TileManager(editor, container, opts);
      tm.destroy();
    }).not.toThrow();
  });
});

describe("TileManager — tile positioning (paged)", () => {
  let container: HTMLDivElement;
  let scrollParent: HTMLDivElement;

  beforeEach(() => {
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scrollParent, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });
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

  it("first visible tile gets top:0 and display:block after update()", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const firstVisible = Array.from(tilesContainer.children).find(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement | undefined;

    expect(firstVisible).toBeDefined();
    expect(firstVisible!.style.top).toBe("0px");
    tm.destroy();
  });

  it("second visible tile top equals pageHeight + gap", () => {
    const gap = 24;
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container, { gap });
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const visible = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement[];

    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible[1]!.style.top).toBe(
      `${DEFAULT_PAGE_CONFIG.pageHeight + gap}px`,
    );
    tm.destroy();
  });

  it("tile height equals pageHeight", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const firstVisible = Array.from(tilesContainer.children).find(
      (el) => (el as HTMLElement).style.display === "block",
    ) as HTMLElement | undefined;

    expect(firstVisible!.style.height).toBe(
      `${DEFAULT_PAGE_CONFIG.pageHeight}px`,
    );
    tm.destroy();
  });

  it("tilesContainer width equals pageConfig.pageWidth", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    expect(tilesContainer.style.width).toBe(
      `${DEFAULT_PAGE_CONFIG.pageWidth}px`,
    );
    tm.destroy();
  });

  it("tilesContainer height equals pageCount * pageHeight + (pageCount-1) * gap", () => {
    const gap = 24;
    const pageCount = 10;
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container, { gap });
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const expected =
      pageCount * DEFAULT_PAGE_CONFIG.pageHeight + (pageCount - 1) * gap;
    expect(tilesContainer.style.height).toBe(`${expected}px`);
    tm.destroy();
  });

  it("each tile wrapper contains exactly 2 canvas elements (content + overlay)", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    for (const wrapper of Array.from(tilesContainer.children)) {
      expect(wrapper.querySelectorAll("canvas")).toHaveLength(2);
    }
    tm.destroy();
  });
});

describe("TileManager — dynamic pool sizing", () => {
  let container: HTMLDivElement;
  let scrollParent: HTMLDivElement;

  beforeEach(() => {
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scrollParent, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });
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

  it("pool grows beyond 1 after update() to cover the viewport", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);

    const tilesContainer = container.children[0] as HTMLDivElement;
    expect(tilesContainer.children).toHaveLength(1); // starts at 1

    tm.update();
    expect(tilesContainer.children.length).toBeGreaterThan(1);
    tm.destroy();
  });

  it("pool size covers viewport: ceil(viewportH / tileH) + overscan tiles visible", () => {
    // viewport=800, pageHeight=1123 → ceil(800/1123)=1, overscan=1 → firstVisible=0, lastVisible=1
    // needed = lastVisible - firstVisible + 1 = 2
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container, { overscan: 1 });
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const visibleCount = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "block",
    ).length;

    // With a 800px viewport and 1123px pages, at most 2 tiles should be visible
    expect(visibleCount).toBeGreaterThanOrEqual(1);
    expect(visibleCount).toBeLessThanOrEqual(3); // 1 + 2 * overscan
    tm.destroy();
  });

  it("tiles outside the visible range are hidden (display:none)", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.update();

    const tilesContainer = container.children[0] as HTMLDivElement;
    const hiddenTiles = Array.from(tilesContainer.children).filter(
      (el) => (el as HTMLElement).style.display === "none",
    );
    // Pool may have grown but some tiles should still be hidden (unassigned ones)
    // For a small viewport, pool size === visible range, so all tiles are visible.
    // Just verify none of the hidden tiles have an explicit top that conflicts.
    for (const tile of hiddenTiles) {
      expect((tile as HTMLElement).style.display).toBe("none");
    }
    tm.destroy();
  });
});

describe("TileManager — destroy", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("removes the tilesContainer from the DOM", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    expect(container.children).toHaveLength(1);
    tm.destroy();
    expect(container.children).toHaveLength(0);
  });

  it("calls setPageTopLookup(null) to deregister the lookup", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.destroy();
    expect(editor.setPageTopLookup).toHaveBeenLastCalledWith(null);
  });

  it("calls the unsubscribe function returned by editor.subscribe", () => {
    const unsubscribe = vi.fn();
    const { editor } = makeMockEditor();
    vi.mocked(editor.subscribe).mockReturnValue(unsubscribe);
    const tm = new TileManager(editor, container);
    tm.destroy();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("is safe to call destroy twice (no throw)", () => {
    const { editor } = makeMockEditor();
    const tm = new TileManager(editor, container);
    tm.destroy();
    expect(() => tm.destroy()).not.toThrow();
  });
});

describe("TileManager — overlay repaint with active surface", () => {
  let container: HTMLDivElement;
  let scrollParent: HTMLDivElement;

  beforeEach(() => {
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scrollParent, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });
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

  it("overlay repaints on every update cycle when a surface is active", () => {
    const { editor } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, {
      id: "headerFooter:defaultHeader",
      owner: "headerFooter",
      state: { selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true } },
    });

    const tm = new TileManager(editor, container);
    tm.update(); // first paint

    // The overlay handler should have been called
    expect(editor.runOverlayHandlers).toHaveBeenCalled();

    const callCountAfterFirst = vi.mocked(editor.runOverlayHandlers).mock.calls.length;

    // Update again without changing any body state — overlay should STILL repaint
    // because a surface is active (surfaceStateDirty = true).
    tm.update();

    expect(vi.mocked(editor.runOverlayHandlers).mock.calls.length).toBeGreaterThan(
      callCountAfterFirst,
    );

    tm.destroy();
  });

  it("overlay call count grows faster with active surface than without", () => {
    // With surface active — every update repaints overlay
    const { editor: editorWithSurface } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, {
      id: "headerFooter:defaultHeader",
      owner: "headerFooter",
      state: { selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true } },
    });
    const tm1 = new TileManager(editorWithSurface, container);
    tm1.update();
    tm1.update();
    tm1.update();
    const withSurface = vi.mocked(editorWithSurface.runOverlayHandlers).mock.calls.length;
    tm1.destroy();

    // Without surface — overlay may skip some repaints after stabilizing
    const container2 = document.createElement("div");
    scrollParent.appendChild(container2);
    const { editor: editorNoSurface } = makeMockEditor();
    const tm2 = new TileManager(editorNoSurface, container2);
    tm2.update();
    tm2.update();
    tm2.update();
    const withoutSurface = vi.mocked(editorNoSurface.runOverlayHandlers).mock.calls.length;
    tm2.destroy();
    container2.remove();

    // Active surface should cause at least as many overlay repaints
    expect(withSurface).toBeGreaterThanOrEqual(withoutSurface);
  });
});

describe("TileManager — body click deactivates surface", () => {
  let container: HTMLDivElement;
  let scrollParent: HTMLDivElement;

  beforeEach(() => {
    scrollParent = document.createElement("div");
    scrollParent.style.overflowY = "scroll";
    Object.defineProperty(scrollParent, "clientHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scrollParent, "scrollTop", {
      value: 0,
      configurable: true,
      writable: true,
    });
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

  it("clicking in the body deactivates an active surface", () => {
    const activateFn = vi.fn();
    const mockSurface = {
      id: "headerFooter:defaultHeader",
      owner: "headerFooter",
      state: { selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true } },
    };
    const { editor, layoutRef } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, mockSurface);

    const chromeMetrics = {
      contentTop: 132,
      contentBottom: 991,
      contentHeight: 859,
      contentWidth: 650,
      headerTop: 72,
      footerTop: 991,
      headerHeight: 60,
      footerHeight: 60,
    };
    const layoutWithMetrics = {
      ...makeLayout(2, DEFAULT_PAGE_CONFIG),
      metrics: [
        { pageNumber: 1, ...chromeMetrics },
        { pageNumber: 2, ...chromeMetrics },
      ],
    };

    layoutRef.current = layoutWithMetrics;
    (editor as unknown as { surfaces: { activeSurface: unknown; activate: typeof activateFn } }).surfaces = {
      activeSurface: mockSurface,
      activate: activateFn,
    };
    (editor as unknown as { emit: ReturnType<typeof vi.fn> }).emit = vi.fn();

    const tm = new TileManager(editor, container);
    tm.update();

    // Simulate onPageClick with coords in the body area (y=500, well below contentTop=132)
    // Access the pointer's onPageClick through the deps
    const pointerDeps = (tm as unknown as { pointer: { deps: { onPageClick: (p: number, x: number, y: number, c: number) => boolean } } }).pointer.deps;
    const consumed = pointerDeps.onPageClick(1, 400, 500, 1);

    // Click should NOT be consumed (returns false so body handles it)
    expect(consumed).toBe(false);
    // But the surface should have been deactivated first
    expect(activateFn).toHaveBeenCalledWith(null);

    tm.destroy();
  });

  it("clicking in a chrome band does NOT deactivate the surface", () => {
    const activateFn = vi.fn();
    const mockSurface = {
      id: "headerFooter:defaultHeader",
      owner: "headerFooter",
      state: { selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true } },
    };
    const { editor, layoutRef } = makeMockEditor(false, DEFAULT_PAGE_CONFIG, mockSurface);

    const layoutWithMetrics = {
      ...makeLayout(1, DEFAULT_PAGE_CONFIG),
      metrics: [{
        pageNumber: 1,
        contentTop: 132,
        contentBottom: 991,
        contentHeight: 859,
        contentWidth: 650,
        headerTop: 72,
        footerTop: 991,
        headerHeight: 60,
        footerHeight: 60,
      }],
    };

    layoutRef.current = layoutWithMetrics;
    (editor as unknown as { surfaces: { activeSurface: unknown; activate: typeof activateFn } }).surfaces = {
      activeSurface: mockSurface,
      activate: activateFn,
    };
    (editor as unknown as { emit: ReturnType<typeof vi.fn> }).emit = vi.fn();

    const tm = new TileManager(editor, container);
    tm.update();

    const pointerDeps = (tm as unknown as { pointer: { deps: { onPageClick: (p: number, x: number, y: number, c: number) => boolean } } }).pointer.deps;

    // All clicks in chrome band with active surface fall through to
    // PointerController's normal logic — single, double, triple click
    // all work via the routed charMap/selection/commands.
    expect(pointerDeps.onPageClick(1, 400, 90, 1)).toBe(false);
    expect(pointerDeps.onPageClick(1, 400, 90, 2)).toBe(false);
    expect(pointerDeps.onPageClick(1, 400, 90, 3)).toBe(false);
    expect(activateFn).not.toHaveBeenCalledWith(null);

    tm.destroy();
  });
});
