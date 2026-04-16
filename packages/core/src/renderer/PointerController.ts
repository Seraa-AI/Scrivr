import type { Editor } from "../Editor";
import { NodeSelection } from "prosemirror-state";
import {
  getHandles,
  hitHandle,
  computeNewSize,
} from "./ResizeController";

/**
 * Minimal view of a tile entry — PointerController only needs access to
 * wrapper elements for cursor style updates.
 */
export interface TileEntryView {
  wrapper: HTMLDivElement;
}

/**
 * Dependencies injected into PointerController.
 * Editor is passed directly — PointerController is inherently coupled to
 * its public API (charMap, selection, selectNode, setNodeAttrs, etc.).
 */
export interface PointerControllerDeps {
  editor: Editor;
  tilesContainer: HTMLDivElement;
  pool: TileEntryView[];
  slotHeight: () => number;
  tileHeight: () => number;
  isPageless: () => boolean;
  visualYToDocY: (y: number) => { page: number; docY: number };
  scheduleUpdate: () => void;
}

/**
 * PointerController — owns all mouse interaction logic for TileManager.
 *
 * Responsibilities:
 *   - Hit testing (text, resize handles, float bodies)
 *   - Click counting (double/triple-click word/paragraph selection)
 *   - Drag tracking (text selection, image resize, float body drag)
 *   - Hover cursor management
 */
export class PointerController {
  private isDragging = false;
  private resizeDrag: {
    handle: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    docPos: number;
    pendingWidth: number;
    pendingHeight: number;
  } | null = null;
  private floatDrag: {
    docPos: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null = null;

  /** Click-count tracking for double/triple-click. */
  private _clickCount = 0;
  private _lastClickTime = 0;
  private _lastClickX = 0;
  private _lastClickY = 0;
  /** Word boundaries from double-click — used for word-granularity drag. */
  private _wordAnchor: { from: number; to: number } | null = null;

  constructor(private readonly deps: PointerControllerDeps) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Attach mouse event listeners. */
  attach(): void {
    this.deps.tilesContainer.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);
  }

  /** Detach mouse event listeners. */
  detach(): void {
    this.deps.tilesContainer.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
  }

  /**
   * Pending resize state during a resize drag.
   * Used by TileManager.paintOverlay to position the ghost handles.
   *
   * `handle` identifies which edge(s) the user grabbed (TL/TC/TR/ML/MR/BL/BC/BR);
   * paintOverlay uses it to pin the opposite edge so the ghost grows in the
   * expected direction (e.g. dragging an "ML" handle left expands the box
   * leftward, not rightward from the original left edge).
   */
  get pendingResize(): {
    width: number;
    height: number;
    handle: string;
  } | null {
    if (!this.resizeDrag) return null;
    return {
      width: this.resizeDrag.pendingWidth,
      height: this.resizeDrag.pendingHeight,
      handle: this.resizeDrag.handle,
    };
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  private hitTest(
    clientX: number,
    clientY: number,
  ): { page: number; docX: number; docY: number } | null {
    const containerRect = this.deps.tilesContainer.getBoundingClientRect();
    const visualX = clientX - containerRect.left;
    const visualY = clientY - containerRect.top;

    // In paged mode, check if the click landed in an inter-page gap.
    if (!this.deps.isPageless()) {
      const sh = this.deps.slotHeight();
      const th = this.deps.tileHeight();
      const posInSlot = visualY % sh;
      if (posInSlot >= th) {
        const tileIndex = Math.floor(visualY / sh);
        return { page: tileIndex + 1, docX: visualX, docY: th };
      }
    }

    const { page, docY } = this.deps.visualYToDocY(visualY);
    return { page, docX: visualX, docY };
  }

  private hitHandleAt(canvasX: number, canvasY: number, page: number) {
    const { editor } = this.deps;
    const sel = editor.getState().selection;
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image")
      return null;
    const r = editor.charMap.getObjectRect(sel.from);
    if (!r || r.page !== page) return null;
    return hitHandle(canvasX, canvasY, getHandles(r.x, r.y, r.width, r.height));
  }

  private hitFloatAt(canvasX: number, canvasY: number, page: number) {
    const floats = this.deps.editor.layout.floats;
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

  // ── Mouse events ────────────────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    const { editor } = this.deps;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) return;

    const { page, docX, docY } = hit;

    // Resize handle — mutation, block in read-only
    const resizeHit = this.hitHandleAt(docX, docY, page);
    if (resizeHit) {
      if (editor.readOnly) return;
      const sel = editor.getState().selection as NodeSelection;
      const startW = sel.node.attrs["width"] as number;
      const startH = sel.node.attrs["height"] as number;
      this.resizeDrag = {
        handle: resizeHit.id,
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        docPos: sel.from,
        pendingWidth: startW,
        pendingHeight: startH,
      };
      this.setCursorAll(resizeHit.cursor);
      return;
    }

    // Float body drag — mutation, block in read-only
    const floatHit = this.hitFloatAt(docX, docY, page);
    if (floatHit) {
      if (editor.readOnly) return;
      editor.selectNode(floatHit.docPos);
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

    if (editor.readOnly) {
      const state = editor.getState();
      if (!state.selection.empty) {
        const { head } = state.selection;
        editor.selection.setSelection(head, head);
      }
      return;
    }

    // ── Click-count tracking (double/triple-click) ──────────────────────────
    const now = Date.now();
    const CLICK_TIMEOUT = 500;
    const CLICK_RADIUS = 5;
    if (
      now - this._lastClickTime < CLICK_TIMEOUT &&
      Math.abs(e.clientX - this._lastClickX) < CLICK_RADIUS &&
      Math.abs(e.clientY - this._lastClickY) < CLICK_RADIUS
    ) {
      this._clickCount++;
    } else {
      this._clickCount = 1;
    }
    this._lastClickTime = now;
    this._lastClickX = e.clientX;
    this._lastClickY = e.clientY;

    this.isDragging = true;
    const pos = editor.charMap.posAtCoords(docX, docY, page);

    // Triple-click → select entire block
    if (this._clickCount >= 3) {
      this._wordAnchor = null;
      editor.selection.selectBlockAt(pos);
      return;
    }

    // Double-click → select word (and enable word-granularity drag)
    if (this._clickCount === 2) {
      const bounds = editor.selection.selectWordAt(pos);
      this._wordAnchor = bounds;
      return;
    }

    this._wordAnchor = null;

    if (!e.shiftKey) {
      // Click physically inside an inline image's rect → select the image.
      // Anywhere else (including 1px outside the image or in the text immediately
      // adjacent to it) → place the cursor via posAtCoords. Using the visual
      // rect rather than nodeBefore/nodeAfter is required because posAtCoords
      // snaps to imagePos / imagePos+1 for clicks on the preceding text glyph's
      // right half, which would otherwise trigger an unwanted NodeSelection.
      const imageHit = editor.charMap.objectRectAtPoint(docX, docY, page);
      if (imageHit) {
        editor.selectNode(imageHit.docPos);
        return;
      }
      editor.selection.moveCursorTo(pos);
    } else {
      editor.selection.setSelection(editor.getState().selection.anchor, pos);
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const { editor } = this.deps;

    // Resize drag — buffer pending size; commit only on mouseup
    if (this.resizeDrag) {
      const { handle, startX, startY, startW, startH } = this.resizeDrag;
      const { pageWidth, margins } = editor.layout.pageConfig;
      const maxWidth = pageWidth - margins.left - margins.right;
      const { width, height } = computeNewSize(
        handle,
        startW,
        startH,
        e.clientX - startX,
        e.clientY - startY,
        maxWidth,
      );
      this.resizeDrag.pendingWidth = width;
      this.resizeDrag.pendingHeight = height;
      this.deps.scheduleUpdate();
      return;
    }

    // Float drag
    if (this.floatDrag) {
      const { docPos, startX, startY, startOffsetX, startOffsetY } =
        this.floatDrag;
      editor.setNodeAttrs(docPos, {
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
      this.setCursorAll(cursor);
    }

    // Text selection drag
    if (!this.isDragging || !hit) return;
    const pos = editor.charMap.posAtCoords(hit.docX, hit.docY, hit.page);

    // Word-granularity drag (after double-click)
    if (this._wordAnchor) {
      const { from: wFrom, to: wTo } = this._wordAnchor;
      if (pos < wFrom) {
        const wordStart = editor.selection.wordBoundary(pos, -1);
        editor.selection.setSelection(wTo, wordStart);
      } else if (pos > wTo) {
        const wordEnd = editor.selection.wordBoundary(pos, 1);
        editor.selection.setSelection(wFrom, wordEnd);
      } else {
        editor.selection.setSelection(wFrom, wTo);
      }
      return;
    }

    editor.selection.setSelection(editor.getState().selection.anchor, pos);
  };

  private handleMouseUp = (): void => {
    const { editor } = this.deps;
    if (this.resizeDrag) {
      const { docPos, pendingWidth, pendingHeight } = this.resizeDrag;
      editor.setNodeAttrs(docPos, { width: pendingWidth, height: pendingHeight });
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
    this.deps.tilesContainer.style.cursor = cursor;
    for (const entry of this.deps.pool) {
      entry.wrapper.style.cursor = cursor;
    }
  }
}
