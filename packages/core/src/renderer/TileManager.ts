import type { Editor } from "../Editor";
import type { DocumentLayout, LayoutFragment } from "../layout/PageLayout";
import { setupCanvas, clearCanvas } from "./canvas";
import { renderPage } from "./PageRenderer";
import { drawBlock } from "./PageRenderer";
import { clearOverlay, renderCursor, renderSelection } from "./OverlayRenderer";
import { NodeSelection } from "prosemirror-state";
import {
  getHandles,
  hitHandle,
  computeNewSize,
  renderHandles,
} from "./ResizeController";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SMALL_TILE_HEIGHT = 307; // pageless tile height in CSS pixels

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface TileEntry {
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
  // ── Overlay blink guard ───────────────────────────────────────────────────
  lastBlinkState: boolean;
  lastCursorTile: number;
  lastSelectionKey: string; // "head:from:to"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── TileManager ───────────────────────────────────────────────────────────────

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
  private isDragging = false;
  private readonly gap: number;
  private readonly overscan: number;
  private readonly showMarginGuides: boolean;
  private readonly smallTileHeight: number;
  private readonly pageStyle: Partial<CSSStyleDeclaration>;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDrag: {
    handle: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    docPos: number;
  } | null = null;
  private floatDrag: {
    docPos: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null = null;
  private _firstPaintDone = false;

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
    this.tilesContainer.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);

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
    this.scheduleUpdate();
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

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

  // ── Scheduling ─────────────────────────────────────────────────────────────

  private scheduleUpdate(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.update();
    });
  }

  // ── Core update loop ───────────────────────────────────────────────────────

  update(): void {
    const layout = this.editor.layout;
    const sh = this.slotHeight;

    // ── First update: find + attach scroll parent ─────────────────────────
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

    // ── Container sizing ──────────────────────────────────────────────────
    const ch = this.containerHeight(layout);
    this.tilesContainer.style.height = `${ch}px`;
    this.tilesContainer.style.width = `${layout.pageConfig.pageWidth}px`;

    // ── Compute visible tile range ────────────────────────────────────────
    const total = this.totalTiles(layout);
    const firstVisible = Math.max(
      0,
      Math.floor(scrollTop / sh) - this.overscan,
    );
    const lastVisible = Math.min(
      total - 1,
      Math.ceil((scrollTop + viewportH) / sh) + this.overscan,
    );

    // ── Grow pool to cover the visible range ──────────────────────────────
    const needed = lastVisible - firstVisible + 1;
    this.ensurePoolSize(needed);

    // ── Release out-of-range tiles (hide, don't remove) ──────────────────
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

    // ── Assign pool entries to visible indices ────────────────────────────
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

  // ── Content painting ───────────────────────────────────────────────────────

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
    const blinkDirty =
      tile.tileIndex === cursorTile && tile.lastBlinkState !== blinkOn;
    const moveDirty =
      tile.lastCursorTile !== cursorTile || tile.lastSelectionKey !== selKey;
    if (!blinkDirty && !moveDirty) return;

    tile.lastBlinkState = blinkOn;
    tile.lastCursorTile = cursorTile;
    tile.lastSelectionKey = selKey;

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
        renderHandles(
          overlayCtx,
          objRect.x,
          objRect.y,
          objRect.width,
          objRect.height,
        );
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
    };
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  private hitTest(
    clientX: number,
    clientY: number,
  ): { page: number; docX: number; docY: number } | null {
    const containerRect = this.tilesContainer.getBoundingClientRect();
    // getBoundingClientRect() already incorporates scroll — do NOT add scrollTop.
    const visualX = clientX - containerRect.left;
    const visualY = clientY - containerRect.top;

    // In paged mode, check if the click landed in an inter-page gap.
    if (!this.editor.isPageless) {
      const sh = this.slotHeight;
      const posInSlot = visualY % sh;
      if (posInSlot >= this.tileHeight) {
        // Click is in the gap — snap to end of the preceding page
        const tileIndex = Math.floor(visualY / sh);
        return { page: tileIndex + 1, docX: visualX, docY: this.tileHeight };
      }
    }

    const { page, docY } = this.visualYToDocY(visualY);
    return { page, docX: visualX, docY };
  }

  private hitHandleAt(canvasX: number, canvasY: number, page: number) {
    const sel = this.editor.getState().selection;
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image")
      return null;
    const r = this.editor.charMap.getObjectRect(sel.from);
    if (!r || r.page !== page) return null;
    return hitHandle(canvasX, canvasY, getHandles(r.x, r.y, r.width, r.height));
  }

  private hitFloatAt(canvasX: number, canvasY: number, page: number) {
    const floats = this.editor.layout.floats;
    if (!floats) return null;
    for (const float of floats) {
      if (float.page !== page) continue;
      if (
        canvasX >= float.x &&
        canvasX <= float.x + float.width &&
        canvasY >= float.y &&
        canvasY <= float.y + float.height
      ) {
        return float;
      }
    }
    return null;
  }

  // ── Mouse events ───────────────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) return;

    const { page, docX, docY } = hit;

    // Resize handle
    const resizeHit = this.hitHandleAt(docX, docY, page);
    if (resizeHit) {
      const sel = this.editor.getState().selection as NodeSelection;
      this.resizeDrag = {
        handle: resizeHit.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: sel.node.attrs["width"] as number,
        startH: sel.node.attrs["height"] as number,
        docPos: sel.from,
      };
      this.setCursorAll(resizeHit.cursor);
      return;
    }

    // Float body drag
    const floatHit = this.hitFloatAt(docX, docY, page);
    if (floatHit) {
      this.editor.selectNode(floatHit.docPos);
      const attrs = floatHit.node.attrs as {
        floatOffset?: { x: number; y: number };
      };
      const off = attrs.floatOffset ?? { x: 0, y: 0 };
      this.floatDrag = {
        docPos: floatHit.docPos,
        startX: e.clientX,
        startY: e.clientY,
        startOffsetX: off.x,
        startOffsetY: off.y,
      };
      this.setCursorAll("move");
      return;
    }

    this.isDragging = true;
    const pos = this.editor.charMap.posAtCoords(docX, docY, page);

    if (!e.shiftKey) {
      const doc = this.editor.getState().doc;
      const $pos = doc.resolve(pos);
      if ($pos.nodeAfter?.type.name === "image") {
        this.editor.selectNode(pos);
        return;
      }
      if ($pos.nodeBefore?.type.name === "image") {
        this.editor.selectNode(pos - $pos.nodeBefore.nodeSize);
        return;
      }
      this.editor.moveCursorTo(pos);
    } else {
      this.editor.setSelection(this.editor.getState().selection.anchor, pos);
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    // Resize drag
    if (this.resizeDrag) {
      const { handle, startX, startY, startW, startH, docPos } =
        this.resizeDrag;
      const { pageWidth, margins } = this.editor.layout.pageConfig;
      const maxWidth = pageWidth - margins.left - margins.right;
      const { width, height } = computeNewSize(
        handle,
        startW,
        startH,
        e.clientX - startX,
        e.clientY - startY,
        maxWidth,
      );
      this.editor.setNodeAttrs(docPos, { width, height });
      return;
    }

    // Float drag
    if (this.floatDrag) {
      const { docPos, startX, startY, startOffsetX, startOffsetY } =
        this.floatDrag;
      this.editor.setNodeAttrs(docPos, {
        floatOffset: {
          x: startOffsetX + (e.clientX - startX),
          y: startOffsetY + (e.clientY - startY),
        },
      });
      return;
    }

    // Hover cursor
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit) {
      const resizeHit = this.hitHandleAt(hit.docX, hit.docY, hit.page);
      const floatHit =
        !resizeHit && this.hitFloatAt(hit.docX, hit.docY, hit.page);
      const cursor = resizeHit ? resizeHit.cursor : floatHit ? "move" : "text";
      this.tilesContainer.style.cursor = cursor;
    }

    // Text selection drag
    if (!this.isDragging || !hit) return;
    const pos = this.editor.charMap.posAtCoords(hit.docX, hit.docY, hit.page);
    this.editor.setSelection(this.editor.getState().selection.anchor, pos);
  };

  private handleMouseUp = (): void => {
    if (this.resizeDrag) {
      this.resizeDrag = null;
      this.setCursorAll("text");
    }
    if (this.floatDrag) {
      this.floatDrag = null;
      this.setCursorAll("text");
    }
    this.isDragging = false;
  };

  private setCursorAll(cursor: string): void {
    this.tilesContainer.style.cursor = cursor;
  }

  // ── Scroll ────────────────────────────────────────────────────────────────

  private handleScroll = (): void => {
    this.scheduleUpdate();
  };

  // ── Destroy ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.unsubscribe?.();
    this.scrollParent?.removeEventListener("scroll", this.handleScroll);
    this.resizeObserver?.disconnect();
    this.tilesContainer.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
    this.activeTiles.clear();
    this.tilesContainer.remove();
    this.editor.setPageTopLookup(null);
  }
}
