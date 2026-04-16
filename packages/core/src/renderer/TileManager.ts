import type { Editor } from "../Editor";
import type { EditorState } from "prosemirror-state";
import type { DocumentLayout, LayoutFragment } from "../layout/PageLayout";
import { setupCanvas, clearCanvas, watchDpr } from "./canvas";
import { renderPage } from "./PageRenderer";
import { drawBlock } from "./PageRenderer";
import { clearOverlay, renderCursor, renderSelection } from "./OverlayRenderer";
import { NodeSelection } from "prosemirror-state";
import { computeGhostRect, renderHandles } from "./ResizeController";
import { PointerController } from "./PointerController";

/** Constants */

const DEFAULT_SMALL_TILE_HEIGHT = 307; // pageless tile height in CSS pixels

/** Types */

export interface TileManagerOptions {
  /** Tile height for pageless mode (default 307). */
  smallTileHeight?: number;
  /** Extra tiles to keep above/below the viewport. Default: 1. */
  overscan?: number;
  /** Gap in CSS pixels between pages in paged mode. Default: 24. */
  gap?: number;
  /** Draw margin guide lines (dev aid). Default: false. */
  showMarginGuides?: boolean;
  /**
   * Style overrides applied to each page tile wrapper in paged mode.
   * Merged on top of defaults — use `boxShadow: "none"` to remove the shadow,
   * `border` to add an outline, `background` to change the page color, etc.
   * Ignored in pageless mode.
   */
  pageStyle?: Partial<CSSStyleDeclaration>;
}

export interface TileEntry {
  wrapper: HTMLDivElement;
  contentCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  dpr: number;
  /** pageless: slice index; paged: pageIndex (0-based). */
  tileIndex: number;
  lastPaintedVersion: number;
  /** Mirrors editor.renderGeneration — forces repaint on asset loads (e.g. images). */
  lastRenderGeneration: number;
  assigned: boolean;
  /** Overlay blink guard */
  lastBlinkState: boolean;
  lastCursorTile: number;
  lastSelectionKey: string; // "head:from:to"
  /** Last seen PM state — detects plugin-state-only transactions (e.g. AI suggestions). */
  lastPmState: EditorState | null;
  /**
   * Last seen resize-drag ghost key ("handle:width:height" or "").
   * Lets the overlay repaint on every mousemove during a resize drag, even
   * though doc state / selection / plugin state don't change until mouseup.
   */
  lastPendingResizeKey: string;
}

/** Helpers */

export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflow, overflowY } = window.getComputedStyle(node);
    if (/auto|scroll/.test(overflow + overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Binary search for fragments whose Y range overlaps [tileTop, tileBottom).
 * `fragments` must be sorted by ascending y.
 */
export function fragmentsInTile(
  fragments: LayoutFragment[],
  tileTop: number,
  tileBottom: number,
): LayoutFragment[] {
  let lo = 0,
    hi = fragments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (fragments[mid]!.y + fragments[mid]!.height <= tileTop) lo = mid + 1;
    else hi = mid;
  }
  const result: LayoutFragment[] = [];
  for (let i = lo; i < fragments.length && fragments[i]!.y < tileBottom; i++) {
    result.push(fragments[i]!);
  }
  return result;
}

/** TileManager */

/**
 * TileManager — unified tile-based renderer for paged and pageless modes.
 *
 * Replaces `ViewManager` as the single rendering engine. Both modes use
 * a fixed pool of canvas tiles that are repositioned as the user scrolls.
 *
 * Paged mode:   tileHeight = pageHeight. One tile = one full page. O(1) lookup.
 * Pageless mode: tileHeight = 307px. Small recycled tiles. O(log N) lookup.
 *
 * The two modes differ in exactly two places:
 *   - `visualYToDocY` / `docYToVisualY` — coordinate mapping
 *   - `paintContent` — paged calls renderPage(); pageless calls drawBlock() with translate
 */
export class TileManager {
  private readonly tilesContainer: HTMLDivElement;
  private scrollParent: HTMLElement | null = null;
  private readonly pool: TileEntry[] = [];
  /** O(1) lookup: tileIndex → pool entry (set when assigned, deleted when released). */
  private readonly activeTiles = new Map<number, TileEntry>();
  private unsubscribe: (() => void) | null = null;
  private rafId: number | null = null;
  private readonly gap: number;
  private readonly overscan: number;
  private readonly showMarginGuides: boolean;
  private readonly smallTileHeight: number;
  private readonly pageStyle: Partial<CSSStyleDeclaration>;
  private resizeObserver: ResizeObserver | null = null;
  private _firstPaintDone = false;
  private _unwatchDpr: (() => void) | null = null;
  private readonly pointer: PointerController;

  constructor(
    private readonly editor: Editor,
    private readonly container: HTMLElement,
    options: TileManagerOptions = {},
  ) {
    this.gap = options.gap ?? 24;
    this.overscan = options.overscan ?? 1;
    this.showMarginGuides = options.showMarginGuides ?? false;
    this.smallTileHeight = options.smallTileHeight ?? DEFAULT_SMALL_TILE_HEIGHT;
    this.pageStyle = options.pageStyle ?? {};

    // ── tiles container ──────────────────────────────────────────────────────
    this.tilesContainer = document.createElement("div");
    Object.assign(this.tilesContainer.style, {
      position: "relative",
      margin: "0 auto",
    });
    container.appendChild(this.tilesContainer);

    // ── tile pool ────────────────────────────────────────────────────────────
    // Pool starts with 1 tile and grows dynamically in update() to cover the
    // viewport. Wrappers are inserted once and never removed — only shown/hidden.
    this.ensurePoolSize(1);

    // ── mouse events ─────────────────────────────────────────────────────────
    this.pointer = new PointerController({
      editor,
      tilesContainer: this.tilesContainer,
      pool: this.pool,
      slotHeight: () => this.slotHeight,
      tileHeight: () => this.tileHeight,
      isPageless: () => this.editor.isPageless,
      visualYToDocY: (y) => this.visualYToDocY(y),
      scheduleUpdate: () => this.scheduleUpdate(),
    });
    this.pointer.attach();

    // ── page screen rect lookup ───────────────────────────────────────────────
    // Returns screen-space top-left of page N. Pure math — no sentinel DOM nodes.
    // Used by scrollCursorIntoView, getViewportRect, getNodeViewportRect.
    editor.setPageTopLookup((page) => {
      const tileRect = this.tilesContainer.getBoundingClientRect();
      const visualY = this.docYToVisualY(page, 0);
      return {
        screenLeft: tileRect.left,
        screenTop: tileRect.top + visualY,
      };
    });

    // ── subscribe to editor ──────────────────────────────────────────────────
    this.unsubscribe = editor.subscribe(() => this.scheduleUpdate());

    // ── DPR change detection (browser zoom, display switch, pinch-to-zoom) ──
    this._unwatchDpr = watchDpr(() => {
      // Force full repaint of all tiles at the new DPR
      for (const tile of this.pool) {
        tile.lastPaintedVersion = -1;
        tile.lastRenderGeneration = -1;
      }
      this.scheduleUpdate();
    });

    this.scheduleUpdate();
  }

  /** Geometry helpers */

  private get tileHeight(): number {
    return this.editor.isPageless
      ? this.smallTileHeight
      : this.editor.pageConfig.pageHeight;
  }

  /**
   * Height of one "slot" — tile height plus the inter-page gap in paged mode.
   * In pageless mode there is no gap.
   */
  private get slotHeight(): number {
    return this.editor.isPageless
      ? this.tileHeight
      : this.tileHeight + this.gap;
  }

  private containerHeight(layout: DocumentLayout): number {
    if (this.editor.isPageless) return layout.totalContentHeight;
    const n = layout.pages.length;
    return n * this.tileHeight + Math.max(0, n - 1) * this.gap;
  }

  private totalTiles(layout: DocumentLayout): number {
    return this.editor.isPageless
      ? Math.ceil(layout.totalContentHeight / this.tileHeight)
      : layout.pages.length;
  }

  /**
   * Convert visual Y (scroll-space) to document-space {page, docY}.
   * Pageless: identity — visualY === docY, always page 1.
   * Paged: tile boundaries align with page boundaries.
   */
  private visualYToDocY(visualY: number): { page: number; docY: number } {
    if (this.editor.isPageless) return { page: 1, docY: visualY };
    const tileIndex = Math.floor(visualY / this.slotHeight);
    const docY = visualY - tileIndex * this.slotHeight;
    return { page: tileIndex + 1, docY };
  }

  /** Convert document-space page + docY to visual Y in the scroll container. */
  private docYToVisualY(page: number, docY: number): number {
    if (this.editor.isPageless) return docY;
    return (page - 1) * this.slotHeight + docY;
  }

  /** Scheduling */

  private scheduleUpdate(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.update();
    });
  }

  /** Core update loop */

  update(): void {
    const layout = this.editor.layout;
    const sh = this.slotHeight;

    /** First update: find + attach scroll parent */
    if (!this.scrollParent) {
      this.scrollParent = findScrollParent(this.container);
      if (this.scrollParent) {
        this.scrollParent.addEventListener("scroll", this.handleScroll, {
          passive: true,
        });
        this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
        this.resizeObserver.observe(this.scrollParent);
      }
    }

    const scrollEl = this.scrollParent;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const viewportH = scrollEl ? scrollEl.clientHeight : window.innerHeight;

    /** ── Container sizing ────────────────────────────────────────────────── */
    const ch = this.containerHeight(layout);
    this.tilesContainer.style.height = `${ch}px`;
    this.tilesContainer.style.width = `${layout.pageConfig.pageWidth}px`;

    /** Compute visible tile range */
    const total = this.totalTiles(layout);
    const firstVisible = Math.max(
      0,
      Math.floor(scrollTop / sh) - this.overscan,
    );
    const lastVisible = Math.min(
      total - 1,
      Math.ceil((scrollTop + viewportH) / sh) + this.overscan,
    );

    /** Grow pool to cover the visible range (pre-allocate on first layout to avoid mid-scroll DOM insertions) */
    const needed = Math.max(
      lastVisible - firstVisible + 1,
      this.pool.length === 1 ? Math.ceil(viewportH / sh) + 2 * this.overscan : 0,
    );
    this.ensurePoolSize(needed);

    /** Release out-of-range tiles (hide, don't remove) */
    for (const tile of this.pool) {
      if (
        tile.assigned &&
        (tile.tileIndex < firstVisible || tile.tileIndex > lastVisible)
      ) {
        this.activeTiles.delete(tile.tileIndex);
        tile.assigned = false;
        tile.wrapper.style.display = "none";
      }
    }

    /** Assign pool entries to visible indices */
    for (let idx = firstVisible; idx <= lastVisible; idx++) {
      // O(1) lookup — already assigned?
      let tile = this.activeTiles.get(idx);

      if (!tile) {
        tile = this.pool.find((t) => !t.assigned);
        if (!tile) {
          console.warn(
            `[TileManager] Pool exhausted at idx=${idx} (pool size=${this.pool.length})`,
          );
          continue;
        }

        tile.assigned = true;
        tile.tileIndex = idx;
        tile.lastPaintedVersion = -1;
        tile.lastRenderGeneration = -1;
        tile.lastBlinkState = false;
        tile.lastCursorTile = -1;
        tile.lastSelectionKey = "";
        tile.lastPmState = null;
        tile.lastPendingResizeKey = "";
        tile.wrapper.style.top = `${idx * sh}px`;
        tile.wrapper.style.height = `${this.tileHeight}px`;
        tile.wrapper.style.display = "block";
        this.activeTiles.set(idx, tile);
      }

      // Snapshot version once — content + overlay use the same snapshot
      const version = layout.version;
      this.paintContent(tile, layout, version);
      this.paintOverlay(tile, layout, version);
    }
  }

  /** Content painting */

  private paintContent(
    tile: TileEntry,
    layout: DocumentLayout,
    version: number,
  ): void {
    const renderGen = this.editor.renderGeneration;
    if (
      tile.lastPaintedVersion === version &&
      tile.lastRenderGeneration === renderGen
    )
      return;

    const pageNumber = tile.tileIndex + 1; // 1-based
    this.editor.ensurePagePopulated(pageNumber);

    if (!this._firstPaintDone) {
      performance.mark("scrivr:first-paint-start");
    }

    if (this.editor.isPageless) {
      this.paintContentPageless(tile, layout);
    } else {
      this.paintContentPaged(tile, layout, pageNumber);
    }

    tile.lastPaintedVersion = version;
    tile.lastRenderGeneration = renderGen;

    if (!this._firstPaintDone) {
      performance.mark("scrivr:first-paint-end");
      performance.measure(
        "scrivr:first-paint (tile manager)",
        "scrivr:first-paint-start",
        "scrivr:first-paint-end",
      );
      this._firstPaintDone = true;
    }
  }

  private paintContentPaged(
    tile: TileEntry,
    layout: DocumentLayout,
    _pageNumber: number,
  ): void {
    const { pageConfig } = layout;
    const page = layout.pages[tile.tileIndex];
    if (!page) return;

    const { dpr } = setupCanvas(tile.contentCanvas, {
      width: pageConfig.pageWidth,
      height: pageConfig.pageHeight,
    });
    tile.dpr = dpr;

    // Size overlay canvas to match
    tile.overlayCanvas.width = Math.round(pageConfig.pageWidth * dpr);
    tile.overlayCanvas.height = Math.round(pageConfig.pageHeight * dpr);
    tile.overlayCanvas.style.width = `${pageConfig.pageWidth}px`;
    tile.overlayCanvas.style.height = `${pageConfig.pageHeight}px`;

    renderPage({
      ctx: tile.contentCanvas.getContext("2d", { alpha: false })!,
      page,
      pageConfig,
      renderVersion: layout.version,
      currentVersion: () => this.editor.layout.version,
      dpr,
      measurer: this.editor.measurer,
      map: this.editor.charMap,
      markDecorators: this.editor.markDecorators,
      showMarginGuides: this.showMarginGuides,
      ...(this.editor.blockRegistry
        ? { blockRegistry: this.editor.blockRegistry }
        : {}),
      ...(this.editor.inlineRegistry
        ? { inlineRegistry: this.editor.inlineRegistry }
        : {}),
      ...(layout.floats ? { floats: layout.floats } : {}),
    });
  }

  private paintContentPageless(tile: TileEntry, layout: DocumentLayout): void {
    const { pageConfig } = layout;
    const tileTop = tile.tileIndex * this.tileHeight;
    const tileBottom = tileTop + this.tileHeight;
    const fragments = layout.fragments
      ? fragmentsInTile(layout.fragments, tileTop, tileBottom)
      : [];

    const dpr = window.devicePixelRatio ?? 1;
    tile.dpr = dpr;

    // Size canvases
    const w = pageConfig.pageWidth;
    const h = this.tileHeight;
    tile.contentCanvas.width = Math.round(w * dpr);
    tile.contentCanvas.height = Math.round(h * dpr);
    tile.contentCanvas.style.width = `${w}px`;
    tile.contentCanvas.style.height = `${h}px`;
    tile.overlayCanvas.width = Math.round(w * dpr);
    tile.overlayCanvas.height = Math.round(h * dpr);
    tile.overlayCanvas.style.width = `${w}px`;
    tile.overlayCanvas.style.height = `${h}px`;

    const ctx = tile.contentCanvas.getContext("2d", { alpha: false })!;
    clearCanvas(ctx, w, h, dpr);
    // After clearCanvas: transform = scale(dpr). Translate so block.y coords work naturally.
    ctx.save();
    ctx.translate(0, -tileTop);

    // Ensure charmap is populated once per tile, not per fragment.
    // (In pageless mode all content lives on page 1.)
    this.editor.ensurePagePopulated(1);

    let lineIndexOffset = 0;
    for (const frag of fragments) {
      const strategy = this.editor.blockRegistry?.get(frag.block.blockType);
      if (strategy) {
        lineIndexOffset = strategy.render(
          frag.block,
          {
            ctx,
            pageNumber: 1,
            lineIndexOffset,
            dpr,
            measurer: this.editor.measurer,
            ...(this.editor.markDecorators
              ? { markDecorators: this.editor.markDecorators }
              : {}),
            ...(this.editor.inlineRegistry
              ? { inlineRegistry: this.editor.inlineRegistry }
              : {}),
          },
          this.editor.charMap,
        );
      } else {
        lineIndexOffset = drawBlock(
          ctx,
          frag.block,
          this.editor.measurer,
          this.editor.charMap,
          1,
          lineIndexOffset,
          this.editor.markDecorators,
        );
      }
    }

    ctx.restore();
  }

  // ── Overlay painting ───────────────────────────────────────────────────────

  private paintOverlay(
    tile: TileEntry,
    layout: DocumentLayout,
    _version: number,
  ): void {
    const { pageConfig } = layout;
    const tileTop = tile.tileIndex * this.tileHeight;
    const cursorPage = this.editor.cursorPage;
    const isPageless = this.editor.isPageless;
    const cursorTile = isPageless
      ? Math.floor(
          this.docYToVisualY(cursorPage, this.cursorDocY()) / this.tileHeight,
        )
      : cursorPage - 1;

    const sel = this.editor.getSelectionSnapshot();
    const selKey = `${sel.head}:${sel.from}:${sel.to}`;
    const blinkOn =
      this.editor.isFocused && this.editor.cursorManager.isVisible;

    // ── Blink gate ────────────────────────────────────────────────────────
    const pmState = this.editor.getState();
    const pending = this.pointer.pendingResize;
    const pendingKey = pending
      ? `${pending.handle}:${pending.width}:${pending.height}`
      : "";
    const blinkDirty =
      tile.tileIndex === cursorTile && tile.lastBlinkState !== blinkOn;
    const moveDirty =
      tile.lastCursorTile !== cursorTile || tile.lastSelectionKey !== selKey;
    // Also repaint when PM plugin state changes (e.g. AI suggestion shown/hidden)
    // without a cursor or selection movement.
    const pluginStateDirty = tile.lastPmState !== pmState;
    // And on every resize-drag mousemove: doc/selection/plugin state don't
    // change until mouseup, so without this the ghost handles would freeze
    // at their starting size and the image would "snap" on release.
    const pendingResizeDirty = tile.lastPendingResizeKey !== pendingKey;
    if (!blinkDirty && !moveDirty && !pluginStateDirty && !pendingResizeDirty)
      return;

    tile.lastBlinkState = blinkOn;
    tile.lastCursorTile = cursorTile;
    tile.lastSelectionKey = selKey;
    tile.lastPmState = pmState;
    tile.lastPendingResizeKey = pendingKey;

    const dpr = tile.dpr || (window.devicePixelRatio ?? 1);
    const w = pageConfig.pageWidth;
    const h = this.tileHeight;

    const overlayCtx = tile.overlayCanvas.getContext("2d")!;
    clearOverlay(overlayCtx, w, h, dpr);
    // After clearOverlay: transform = scale(dpr). Apply tile translate for pageless.
    if (isPageless) {
      overlayCtx.save();
      overlayCtx.translate(0, -tileTop);
    }

    const pmSel = this.editor.getState().selection;
    const isNodeSel = pmSel instanceof NodeSelection;
    const pageNum = isPageless ? 1 : tile.tileIndex + 1;

    // ── Selection ─────────────────────────────────────────────────────────
    if (!sel.empty && !isNodeSel) {
      const lines = this.editor.charMap
        .linesInRange(sel.from, sel.to)
        .filter((l) => l.page === pageNum);
      const glyphs = this.editor.charMap
        .glyphsInRange(sel.from, sel.to)
        .filter((g) => g.page === pageNum);
      renderSelection(overlayCtx, lines, glyphs, sel.from, sel.to);
    }

    // ── Cursor ────────────────────────────────────────────────────────────
    if (!isNodeSel && blinkOn && tile.tileIndex === cursorTile) {
      const coords = this.editor.charMap.coordsAtPos(sel.head, pageNum);
      if (coords) renderCursor(overlayCtx, coords);
    }

    // ── Image selection handles ───────────────────────────────────────────
    if (isNodeSel && pmSel.node.type.name === "image") {
      const objRect = this.editor.charMap.getObjectRect(pmSel.from);
      if (objRect && objRect.page === pageNum) {
        // During resize drag, show ghost handles at the pending size, pinned
        // to the edge opposite the dragged handle. Without computeGhostRect
        // the ghost would always grow from objRect's top-left, so dragging a
        // left/top handle in its expected direction would visually grow the
        // box the wrong way (right/down) until mouseup committed the attrs.
        if (pending) {
          const g = computeGhostRect(
            pending.handle,
            objRect.x,
            objRect.y,
            objRect.width,
            objRect.height,
            pending.width,
            pending.height,
          );
          renderHandles(overlayCtx, g.x, g.y, g.width, g.height);
        } else {
          renderHandles(
            overlayCtx,
            objRect.x,
            objRect.y,
            objRect.width,
            objRect.height,
          );
        }
      }
    }

    // ── Extension overlay handlers ────────────────────────────────────────
    this.editor.runOverlayHandlers(overlayCtx, pageNum, pageConfig);

    if (isPageless) overlayCtx.restore();
  }

  /** Returns the document-space Y of the cursor (for pageless tile index computation). */
  private cursorDocY(): number {
    const coords = this.editor.charMap.coordsAtPos(
      this.editor.getState().selection.head,
    );
    return coords?.y ?? 0;
  }

  // ── Tile pool ─────────────────────────────────────────────────────────────

  /**
   * Grows the pool to at least `needed` entries. New tiles are appended to
   * tilesContainer with `display:none` — same as the initial pool entries.
   */
  private ensurePoolSize(needed: number): void {
    for (let i = this.pool.length; i < needed; i++) {
      const entry = this.createTileEntry();
      this.tilesContainer.appendChild(entry.wrapper);
      this.pool.push(entry);
    }
  }

  private createTileEntry(): TileEntry {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      boxSizing: "content-box",
      position: "absolute",
      left: "0",
      width: "100%", // tilesContainer carries pageWidth; 100% fills it
      display: "none", // hidden until assigned by update()
      cursor: "text",
      userSelect: "none",
      // Paged mode defaults — overridden by pageStyle option
      ...(!this.editor.isPageless
        ? {
            boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
            background: "#fff",
          }
        : {}),
      ...(!this.editor.isPageless ? this.pageStyle : {}),
    });

    const contentCanvas = document.createElement("canvas");
    Object.assign(contentCanvas.style, {
      display: "block",
      position: "absolute",
      top: "0",
      left: "0",
    });

    const overlayCanvas = document.createElement("canvas");
    Object.assign(overlayCanvas.style, {
      display: "block",
      position: "absolute",
      top: "0",
      left: "0",
      pointerEvents: "none",
    });

    wrapper.appendChild(contentCanvas);
    wrapper.appendChild(overlayCanvas);

    return {
      wrapper,
      contentCanvas,
      overlayCanvas,
      dpr: 1,
      tileIndex: -1,
      lastPaintedVersion: -1,
      lastRenderGeneration: -1,
      assigned: false,
      lastBlinkState: false,
      lastCursorTile: -1,
      lastSelectionKey: "",
      lastPmState: null,
      lastPendingResizeKey: "",
    };
  }

  /** Scroll */

  private handleScroll = (): void => {
    this.scheduleUpdate();
  };

  /** Destroy */

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.unsubscribe?.();
    this._unwatchDpr?.();
    this.scrollParent?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.pointer.detach();
    this.activeTiles.clear();
    this.tilesContainer.remove();
    this.editor.setPageTopLookup(null);
  }
}
