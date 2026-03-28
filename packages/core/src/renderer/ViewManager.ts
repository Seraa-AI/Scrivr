import type { Editor } from "../Editor";
import type { DocumentLayout, LayoutPage, PageConfig } from "../layout/PageLayout";
import { setupCanvas } from "./canvas";
import { renderPage } from "./PageRenderer";
import { clearOverlay, renderCursor, renderSelection } from "./OverlayRenderer";
import { NodeSelection } from "prosemirror-state";
import { getHandles, hitHandle, computeNewSize, renderHandles } from "./ResizeController";

interface PageEntry {
  wrapper: HTMLDivElement;
  contentCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  dpr: number;
  lastPaintedVersion: number;
  canvasesAttached: boolean;
}

export interface ViewManagerOptions {
  gap?: number;
  overscan?: number;
  showMarginGuides?: boolean;
}

/**
 * ViewManager — the rendering engine's bridge to the DOM.
 *
 * Owns:
 *   - Page wrapper divs (created/removed to match the layout)
 *   - Two canvases per page: content (text) and overlay (cursor + selection)
 *   - IntersectionObserver for virtual scrolling
 *   - Mouse event handlers (click, drag for selection)
 *
 * Called synchronously from Editor.notifyListeners() so canvas pixels are
 * always up-to-date before the browser paints. This eliminates the ghost
 * cursor and the one-frame lag that React lifecycle hooks introduce.
 *
 * Framework-agnostic — works with any adapter that provides a container div.
 */
export class ViewManager {
  private pages = new Map<number, PageEntry>();
  private pagesContainer: HTMLElement;
  private observer: IntersectionObserver;
  private visiblePages = new Set<number>([1]);
  private isDragging = false;
  private gap: number;
  private showMarginGuides: boolean;
  private unsubscribe: (() => void) | null = null;
  private resizeDrag: {
    handle: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    docPos: number;
  } | null = null;

  constructor(
    private editor: Editor,
    private container: HTMLElement,
    options: ViewManagerOptions = {},
  ) {
    this.gap = options.gap ?? 24;
    this.showMarginGuides = options.showMarginGuides ?? false;

    this.pagesContainer = document.createElement("div");
    Object.assign(this.pagesContainer.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    });
    container.appendChild(this.pagesContainer);

    this.observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const pageNum = Number(entry.target.getAttribute("data-page"));
          if (entry.isIntersecting) {
            if (!this.visiblePages.has(pageNum)) {
              this.visiblePages.add(pageNum);
              changed = true;
            }
          } else {
            if (this.visiblePages.has(pageNum)) {
              this.visiblePages.delete(pageNum);
              changed = true;
            }
          }
        }
        if (changed) this.update();
      },
      { rootMargin: `${options.overscan ?? 500}px`, threshold: 0 },
    );

    this.pagesContainer.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);

    editor.setPageElementLookup((page) => this.pages.get(page)?.wrapper ?? null);

    this.unsubscribe = editor.subscribe(() => this.update());
    this.update();
  }

  /**
   * Synchronises page DOM and repaints visible canvases.
   *
   * Called automatically via editor.subscribe() on every state change,
   * cursor blink, and focus toggle — runs synchronously in the same JS
   * turn as Editor.dispatch(), so the browser never paints a stale frame.
   *
   * Also called by the IntersectionObserver when page visibility changes.
   */
  private _firstPaintDone = false;

  update(): void {
    const layout = this.editor.layout;

    this.syncPages(layout);

    for (const page of layout.pages) {
      const entry = this.pages.get(page.pageNumber);
      if (!entry) continue;

      const isVisible = this.visiblePages.has(page.pageNumber);

      if (isVisible) {
        this.ensureCanvasesAttached(entry, layout.pageConfig);
        if (entry.lastPaintedVersion !== layout.version) {
          if (!this._firstPaintDone) {
            performance.mark("inscribe:first-paint-start");
          }
          this.paintContent(entry, page, layout);
          entry.lastPaintedVersion = layout.version;
          if (!this._firstPaintDone) {
            performance.mark("inscribe:first-paint-end");
            performance.measure(
              "inscribe:first-paint (canvas draw, page 1)",
              "inscribe:first-paint-start",
              "inscribe:first-paint-end",
            );
            this._firstPaintDone = true;
          }
        }
        this.paintOverlay(entry, page);
      } else {
        this.detachCanvases(entry);
      }
    }
  }

  getPageElement(page: number): HTMLElement | null {
    return this.pages.get(page)?.wrapper ?? null;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.observer.disconnect();
    this.pagesContainer.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
    this.pages.clear();
    this.pagesContainer.remove();
    this.editor.setPageElementLookup(null);
  }

  // ── Page DOM sync ──────────────────────────────────────────────────────────

  private syncPages(layout: DocumentLayout): void {
    const { pageConfig } = layout;
    const layoutPageNumbers = new Set(layout.pages.map((p) => p.pageNumber));

    for (const [num, entry] of this.pages) {
      if (!layoutPageNumbers.has(num)) {
        this.observer.unobserve(entry.wrapper);
        entry.wrapper.remove();
        this.pages.delete(num);
        this.visiblePages.delete(num);
      }
    }

    for (const page of layout.pages) {
      if (!this.pages.has(page.pageNumber)) {
        const entry = this.createPageEntry(page.pageNumber, pageConfig);
        this.pages.set(page.pageNumber, entry);
        this.pagesContainer.appendChild(entry.wrapper);
        this.observer.observe(entry.wrapper);
        this.visiblePages.add(page.pageNumber);
      }
    }
  }

  private createPageEntry(pageNumber: number, pageConfig: PageConfig): PageEntry {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, {
      width: `${pageConfig.pageWidth}px`,
      height: `${pageConfig.pageHeight}px`,
      marginBottom: `${this.gap}px`,
      boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
      background: "#fff",
      position: "relative",
      flexShrink: "0",
      cursor: "text",
      userSelect: "none",
    });
    wrapper.setAttribute("data-page", String(pageNumber));

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

    return {
      wrapper,
      contentCanvas,
      overlayCanvas,
      dpr: 1,
      lastPaintedVersion: -1,
      canvasesAttached: false,
    };
  }

  private ensureCanvasesAttached(entry: PageEntry, _pageConfig: PageConfig): void {
    if (entry.canvasesAttached) return;
    entry.wrapper.textContent = "";
    entry.wrapper.appendChild(entry.contentCanvas);
    entry.wrapper.appendChild(entry.overlayCanvas);
    entry.canvasesAttached = true;
    entry.lastPaintedVersion = -1;
  }

  private detachCanvases(entry: PageEntry): void {
    if (!entry.canvasesAttached) return;
    entry.wrapper.textContent = "";
    const placeholder = document.createElement("div");
    Object.assign(placeholder.style, { width: "100%", height: "100%", background: "#fff" });
    entry.wrapper.appendChild(placeholder);
    entry.canvasesAttached = false;
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  private paintContent(entry: PageEntry, page: LayoutPage, layout: DocumentLayout): void {
    // Ensure this page's CharacterMap entries exist before rendering.
    // The cursor page is already populated by ensureLayout(); this covers
    // all other visible pages on their first paint.
    this.editor.ensurePagePopulated(page.pageNumber);

    const { pageConfig } = layout;

    const { dpr } = setupCanvas(entry.contentCanvas, {
      width: pageConfig.pageWidth,
      height: pageConfig.pageHeight,
    });
    entry.dpr = dpr;

    entry.overlayCanvas.width = Math.round(pageConfig.pageWidth * dpr);
    entry.overlayCanvas.height = Math.round(pageConfig.pageHeight * dpr);
    entry.overlayCanvas.style.width = `${pageConfig.pageWidth}px`;
    entry.overlayCanvas.style.height = `${pageConfig.pageHeight}px`;

    renderPage({
      ctx: entry.contentCanvas.getContext("2d", { alpha: false })!,
      page,
      pageConfig,
      renderVersion: layout.version,
      currentVersion: () => this.editor.layout.version,
      dpr,
      measurer: this.editor.measurer,
      map: this.editor.charMap,
      markDecorators: this.editor.markDecorators,
      showMarginGuides: this.showMarginGuides,
      ...(this.editor.blockRegistry ? { blockRegistry: this.editor.blockRegistry } : {}),
      ...(this.editor.inlineRegistry ? { inlineRegistry: this.editor.inlineRegistry } : {}),
    });
  }

  private paintOverlay(entry: PageEntry, page: LayoutPage): void {
    if (!entry.canvasesAttached) return;

    // paintOverlay runs every cursor blink — ensure page is populated even if
    // paintContent was skipped (version unchanged) or not yet called.
    this.editor.ensurePagePopulated(page.pageNumber);

    const { pageConfig } = this.editor.layout;
    const ctx = entry.overlayCanvas.getContext("2d")!;
    clearOverlay(ctx, pageConfig.pageWidth, pageConfig.pageHeight, entry.dpr);

    const selection = this.editor.getSelectionSnapshot();

    const pmSelection = this.editor.getState().selection;
    const isNodeSel = pmSelection instanceof NodeSelection;

    if (!selection.empty && !isNodeSel) {
      const lines = this.editor.charMap
        .linesInRange(selection.from, selection.to)
        .filter((l) => l.page === page.pageNumber);
      const glyphs = this.editor.charMap
        .glyphsInRange(selection.from, selection.to)
        .filter((g) => g.page === page.pageNumber);
      renderSelection(ctx, lines, glyphs, selection.from, selection.to);
    }

    if (!isNodeSel && this.editor.isFocused && this.editor.cursorManager.isVisible &&
        page.pageNumber === this.editor.cursorPage) {
      // Scope the search to this page so the preceding-glyph fallback never
      // returns coords from a different page's canvas.
      const coords = this.editor.charMap.coordsAtPos(selection.head, page.pageNumber);
      if (coords) {
        renderCursor(ctx, coords);
      }
    }

    // ── Image selection handles ───────────────────────────────────────────────
    if (isNodeSel && pmSelection.node.type.name === "image") {
      const objRect = this.editor.charMap.getObjectRect(pmSelection.from);
      if (objRect && objRect.page === page.pageNumber) {
        renderHandles(ctx, objRect.x, objRect.y, objRect.width, objRect.height);
      }
    }

    // Extension overlay handlers (e.g. CollaborationCursor for remote cursors)
    this.editor.runOverlayHandlers(ctx, page.pageNumber, pageConfig);
  }

  // ── Mouse events ───────────────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    const pageEl = (e.target as HTMLElement).closest("[data-page]") as HTMLElement | null;
    if (!pageEl) return;

    const pageNumber = Number(pageEl.getAttribute("data-page"));
    const pageRect = pageEl.getBoundingClientRect();
    const canvasX = e.clientX - pageRect.left;
    const canvasY = e.clientY - pageRect.top;

    // ── Resize handle hit-test (takes priority over everything else) ──────────
    const hit = this.hitHandle(canvasX, canvasY, pageNumber);
    if (hit) {
      const sel = this.editor.getState().selection as NodeSelection;
      this.resizeDrag = {
        handle: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: sel.node.attrs["width"] as number,
        startH: sel.node.attrs["height"] as number,
        docPos: sel.from,
      };
      // Lock cursor on all wrappers so it stays consistent as the mouse moves
      // fast outside the current page element during drag.
      for (const entry of this.pages.values()) {
        entry.wrapper.style.cursor = hit.cursor;
      }
      return;
    }

    this.isDragging = true;
    const pos = this.editor.charMap.posAtCoords(canvasX, canvasY, pageNumber);

    if (!e.shiftKey) {
      // Check if the click landed on an inline image node → NodeSelection.
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
    }

    if (e.shiftKey) {
      this.editor.setSelection(this.editor.getState().selection.anchor, pos);
    } else {
      this.editor.moveCursorTo(pos);
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    // ── Resize drag ───────────────────────────────────────────────────────────
    if (this.resizeDrag) {
      const { handle, startX, startY, startW, startH, docPos } = this.resizeDrag;
      const { width, height } = computeNewSize(
        handle,
        startW, startH,
        e.clientX - startX,
        e.clientY - startY,
      );
      this.editor.setNodeAttrs(docPos, { width, height });
      return;
    }

    // ── Hover cursor over handles ─────────────────────────────────────────────
    // Set cursor directly on the page wrapper (which has cursor:"text" inline)
    // so our value wins. Other page wrappers are reset to "text".
    const hoveredPageEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-page]") as HTMLElement | null;

    for (const entry of this.pages.values()) {
      if (entry.wrapper === hoveredPageEl) {
        const pageNumber = Number(hoveredPageEl.getAttribute("data-page"));
        const pageRect = hoveredPageEl.getBoundingClientRect();
        const hit = this.hitHandle(e.clientX - pageRect.left, e.clientY - pageRect.top, pageNumber);
        entry.wrapper.style.cursor = hit ? hit.cursor : "text";
      } else {
        entry.wrapper.style.cursor = "text";
      }
    }

    // ── Normal text-drag selection ────────────────────────────────────────────
    if (!this.isDragging || !hoveredPageEl) return;

    const pageNumber = Number(hoveredPageEl.getAttribute("data-page"));
    const pageRect = hoveredPageEl.getBoundingClientRect();
    const pos = this.editor.charMap.posAtCoords(
      e.clientX - pageRect.left,
      e.clientY - pageRect.top,
      pageNumber,
    );
    this.editor.setSelection(this.editor.getState().selection.anchor, pos);
  };

  private handleMouseUp = (): void => {
    if (this.resizeDrag) {
      this.resizeDrag = null;
      for (const entry of this.pages.values()) {
        entry.wrapper.style.cursor = "text";
      }
    }
    this.isDragging = false;
  };

  /** Returns the handle under canvas-space (x, y) on the given page, or null. */
  private hitHandle(canvasX: number, canvasY: number, page: number) {
    const sel = this.editor.getState().selection;
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") return null;
    const r = this.editor.charMap.getObjectRect(sel.from);
    if (!r || r.page !== page) return null;
    return hitHandle(canvasX, canvasY, getHandles(r.x, r.y, r.width, r.height));
  }
}

