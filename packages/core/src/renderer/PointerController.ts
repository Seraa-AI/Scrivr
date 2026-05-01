import type { Editor } from "../Editor";
import { NodeSelection } from "prosemirror-state";
import {
  getHandles,
  hitHandle,
  computeNewSize,
} from "./ResizeController";
import { normalizeImageAttrs } from "../layout/AnchoredObjects";
import { dragDebugLog } from "./DragDebugOverlay";

/**
 * How close to the rect edge the pointer must be for a resize-handle hit to
 * register. Pointers further inside than this fall through to body-drag
 * hit-testing — without it, an image bigger than ~24px would have no
 * surface available for body drag because resize-handle hit areas would
 * fully cover the rect via getHandles' 8-point grid.
 */
const EDGE_BAND_PX = 12;

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
  /**
   * Called before default text-selection on a page click. If the handler
   * returns true, the click is consumed (e.g. chrome band activation or
   * cursor positioning within an active surface).
   */
  onPageClick?: (page: number, docX: number, docY: number, clickCount: number) => boolean;
}

/**
 * PointerController — owns all mouse interaction logic for TileManager.
 *
 * Responsibilities:
 *   - Hit testing (text, resize handles, anchored-object bodies)
 *   - Click counting (double/triple-click word/paragraph selection)
 *   - Drag tracking (text selection, image resize, anchored-object body drag)
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
  private anchoredDrag: {
    docPos: number;
    nodeSize: number;
    /** Mouse position at drag start, in client coordinates. */
    startClientX: number;
    startClientY: number;
    /** Image's painted X at drag start, in page-local coordinates. */
    startImageX: number;
    /**
     * Anchor flow's globalY snapshot. Frozen at pointerdown — never recomputed
     * during the gesture. Phase 2 spec ("snapshot or die"): drag math reads
     * the snapshot, never live layout, otherwise feedback loops re-create the
     * docPos-mutation drag bug.
     */
    anchorGlobalY: number;
    /** Image's painted globalY at gesture start. Used to derive yOffset on commit. */
    startImageGlobalY: number;
    /** yOffset attr value at pointerdown (= startImageGlobalY - anchorGlobalY). */
    startYOffset: number;
    /** Image's docPos rect at drag start (for posBelow / posAbove fallback). */
    rect: { x: number; y: number; width: number; height: number; page: number };
    /** Mouse position relative to the image's top-left at mousedown. */
    grabOffsetX: number;
    grabOffsetY: number;
    /** Live overlay state — refreshed on mousemove, read by TileManager. */
    overlay: {
      /** Page where the ghost is drawn (= page under the cursor). */
      ghostPage: number;
      /** Page-local top-left of the ghost rect. */
      ghostX: number;
      ghostY: number;
      /** Page + coords of the resolved insertion caret, or null if unresolved. */
      caret: { page: number; x: number; y: number; height: number } | null;
      /**
       * True when the cursor is in a region that can't accept a drop (currently
       * inter-page gaps). Renderer fades the ghost; mouseup commits a no-op.
       */
      disabled: boolean;
    };
  } | null = null;
  private inlineImageDrag: {
    docPos: number;
    nodeSize: number;
    startClientX: number;
    startClientY: number;
    rect: { x: number; y: number; width: number; height: number; page: number };
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

  /**
   * Live drag overlay state during an anchored-object drag. Read by
   * TileManager.paintOverlay to render a translucent ghost of the image
   * at the cursor position and a caret marker at the resolved insertion
   * point. Returns null when no anchored-object drag is in progress.
   *
   * The overlay is paint-only — per docs/anchored-objects/04-edit-ux.md
   * § "Preview non-interference rule" it never influences hit testing,
   * selection, or insertion-point resolution.
   */
  get pendingAnchoredDrag(): {
    sourcePage: number;
    sourceX: number;
    sourceY: number;
    width: number;
    height: number;
    ghostPage: number;
    ghostX: number;
    ghostY: number;
    caret: { page: number; x: number; y: number; height: number } | null;
    disabled: boolean;
  } | null {
    if (!this.anchoredDrag) return null;
    return {
      sourcePage: this.anchoredDrag.rect.page,
      sourceX: this.anchoredDrag.rect.x,
      sourceY: this.anchoredDrag.rect.y,
      width: this.anchoredDrag.rect.width,
      height: this.anchoredDrag.rect.height,
      ghostPage: this.anchoredDrag.overlay.ghostPage,
      ghostX: this.anchoredDrag.overlay.ghostX,
      ghostY: this.anchoredDrag.overlay.ghostY,
      caret: this.anchoredDrag.overlay.caret,
      disabled: this.anchoredDrag.overlay.disabled,
    };
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  private hitTest(
    clientX: number,
    clientY: number,
  ): { page: number; docX: number; docY: number; gap?: boolean } | null {
    const containerRect = this.deps.tilesContainer.getBoundingClientRect();
    const visualX = clientX - containerRect.left;
    const visualY = clientY - containerRect.top;

    // In paged mode, mark inter-page-gap hits with gap:true. Drag callers
    // treat gap hits as invalid drop targets (no transaction, no caret);
    // text-click callers still get a docY clamped to the page bottom so the
    // existing "click below text in a page" behaviour is preserved.
    if (!this.deps.isPageless()) {
      const sh = this.deps.slotHeight();
      const th = this.deps.tileHeight();
      const posInSlot = visualY % sh;
      if (posInSlot >= th) {
        const tileIndex = Math.floor(visualY / sh);
        return { page: tileIndex + 1, docX: visualX, docY: th, gap: true };
      }
    }

    const { page, docY } = this.deps.visualYToDocY(visualY);
    return { page, docX: visualX, docY };
  }

  /** Get the ProseMirror selection from the active editing target (surface or body). */
  private activeSelection() {
    const { editor } = this.deps;
    return editor.surfaces?.activeSurface?.state.selection ?? editor.getState().selection;
  }

  private hitHandleAt(canvasX: number, canvasY: number, page: number) {
    const { editor } = this.deps;
    const sel = this.activeSelection();
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image")
      return null;
    // Step 6: read through editor.getNodeRect so anchored placements come
    // from layout.anchoredObjects (Stage 3 authoritative) and inline images
    // continue to fall back to charMap. Prevents handle-vs-body drift on
    // virtualized pages.
    const r = editor.getNodeRect(sel.from);
    if (!r || r.page !== page) return null;

    // Inner body — pointer is well inside the rect, away from any edge.
    // Fall through so the anchored-body drag wins; otherwise resize handles
    // would steal hits from the entire bounding box, leaving no surface for
    // body drag on normally-sized images.
    const insideRect =
      canvasX >= r.x && canvasX <= r.x + r.width &&
      canvasY >= r.y && canvasY <= r.y + r.height;
    if (insideRect) {
      const distToEdge = Math.min(
        canvasX - r.x,
        r.x + r.width - canvasX,
        canvasY - r.y,
        r.y + r.height - canvasY,
      );
      if (distToEdge > EDGE_BAND_PX) return null;
    }

    return hitHandle(canvasX, canvasY, getHandles(r.x, r.y, r.width, r.height));
  }

  private hitAnchoredAt(canvasX: number, canvasY: number, page: number) {
    const objects = this.deps.editor.layout.anchoredObjects;
    if (!objects) return null;
    for (const object of objects) {
      if (object.page !== page) continue;
      if (
        canvasX >= object.x &&
        canvasX <= object.x + object.width &&
        canvasY >= object.y &&
        canvasY <= object.y + object.height
      ) {
        return object;
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
      const sel = this.activeSelection();
      if (!(sel instanceof NodeSelection)) return;
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
      dragDebugLog(editor, "down", { hitKind: "resize", handle: resizeHit.id, docPos: sel.from, page, docX, docY });
      return;
    }

    // Anchored-object body drag — mutation, block in read-only.
    // Per docs/anchored-objects/04-edit-ux.md: drag is structural —
    // horizontal movement updates `xAlign: "custom"` + `x`; vertical
    // movement updates the docPos. Diagonal drag commits both atomically
    // via Editor.moveAndUpdateNode.
    const anchoredHit = this.hitAnchoredAt(docX, docY, page);
    if (anchoredHit) {
      if (editor.readOnly) return;
      editor.selectNode(anchoredHit.docPos);
      // Mouse position relative to the image's top-left at mousedown — used
      // by mousemove to keep the ghost rect anchored to the cursor's grab
      // point (so the image doesn't snap to the cursor's top-left).
      const grabOffsetX = docX - anchoredHit.x;
      const grabOffsetY = docY - anchoredHit.y;
      this.anchoredDrag = {
        docPos: anchoredHit.docPos,
        nodeSize: anchoredHit.node.nodeSize,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startImageX: anchoredHit.x,
        anchorGlobalY: anchoredHit.anchorGlobalY,
        startImageGlobalY: anchoredHit.globalY,
        startYOffset: anchoredHit.globalY - anchoredHit.anchorGlobalY,
        rect: {
          x: anchoredHit.x,
          y: anchoredHit.y,
          width: anchoredHit.width,
          height: anchoredHit.height,
          page: anchoredHit.page,
        },
        grabOffsetX,
        grabOffsetY,
        overlay: {
          ghostPage: anchoredHit.page,
          ghostX: anchoredHit.x,
          ghostY: anchoredHit.y,
          caret: null,
          disabled: false,
        },
      };
      this.setCursorAll("move");
      dragDebugLog(editor, "down", { hitKind: "anchored", docPos: anchoredHit.docPos, page, docX, docY });
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

    // Chrome band click — consumed for both activation (double-click) and
    // cursor positioning (single click when surface is already active).
    if (!editor.readOnly && this.deps.onPageClick?.(page, docX, docY, this._clickCount)) return;

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
      if (!editor.readOnly) {
        const imageHit = editor.charMap.objectRectAtPoint(docX, docY, page);
        if (imageHit) {
          editor.selectNode(imageHit.docPos);
          const node = editor.getState().doc.nodeAt(imageHit.docPos);
          if (node) {
            this.inlineImageDrag = {
              docPos: imageHit.docPos,
              nodeSize: node.nodeSize,
              startClientX: e.clientX,
              startClientY: e.clientY,
              rect: {
                x: imageHit.x,
                y: imageHit.y,
                width: imageHit.width,
                height: imageHit.height,
                page: imageHit.page,
              },
            };
            this.setCursorAll("move");
          }
          return;
        }
      }
      editor.selection.moveCursorTo(pos);
    } else {
      editor.selection.setSelection(editor.getSelectionSnapshot().anchor, pos);
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

    // Anchored-object drag — keep the ghost overlay tracking the cursor and
    // resolve the live insertion caret. Deltas commit on mouseup; this block
    // is paint-only.
    if (this.anchoredDrag) {
      this.updateAnchoredDragOverlay(e);
      const dx = e.clientX - this.anchoredDrag.startClientX;
      const dy = e.clientY - this.anchoredDrag.startClientY;
      dragDebugLog(editor, "move", {
        dx,
        dy,
        ghostPage: this.anchoredDrag.overlay.ghostPage,
        caretPage: this.anchoredDrag.overlay.caret?.page ?? null,
      });
      this.deps.scheduleUpdate();
      return;
    }

    if (this.inlineImageDrag) {
      this.setCursorAll("move");
      return;
    }

    // Hover cursor
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit) {
      const resizeHit = this.hitHandleAt(hit.docX, hit.docY, hit.page);
      const anchoredHit =
        !resizeHit && this.hitAnchoredAt(hit.docX, hit.docY, hit.page);
      const inlineImageHit =
        !resizeHit && !anchoredHit
          ? editor.charMap.objectRectAtPoint(hit.docX, hit.docY, hit.page)
          : undefined;
      const cursor = resizeHit ? resizeHit.cursor : anchoredHit || inlineImageHit ? "move" : "text";
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

    editor.selection.setSelection(editor.getSelectionSnapshot().anchor, pos);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    const { editor } = this.deps;
    if (this.resizeDrag) {
      const { docPos, pendingWidth, pendingHeight } = this.resizeDrag;
      editor.setNodeAttrs(docPos, { width: pendingWidth, height: pendingHeight });
      this.resizeDrag = null;
      this.setCursorAll("text");
    }
    if (this.anchoredDrag) {
      this.commitAnchoredDrag(e);
      this.anchoredDrag = null;
      this.setCursorAll("text");
    }
    if (this.inlineImageDrag) {
      this.commitInlineImageDrag(e);
      this.inlineImageDrag = null;
      this.setCursorAll("text");
    }
    this.isDragging = false;
  };

  private commitInlineImageDrag(e: MouseEvent): void {
    const { editor } = this.deps;
    if (!this.inlineImageDrag) return;

    const dx = e.clientX - this.inlineImageDrag.startClientX;
    const dy = e.clientY - this.inlineImageDrag.startClientY;
    const DRAG_THRESHOLD = 3;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

    const targetDocPos = this.resolveDragTargetDocPosFrom(e, this.inlineImageDrag);
    if (targetDocPos === null) return;

    const { docPos, nodeSize } = this.inlineImageDrag;
    if (targetDocPos >= docPos && targetDocPos <= docPos + nodeSize) return;

    editor.moveNode(docPos, targetDocPos);
    dragDebugLog(editor, "commit", {
      commitPath: "moveNode",
      docPos,
      newDocPos: targetDocPos,
      inline: true,
    });
  }

  /**
   * Resolve and commit an anchored-object drag. Per the yOffset redesign
   * (docs/anchored-objects/06-yoffset-redesign.md § Phase 2):
   *
   *   Same-page drop → setNodeAttrs({ xAlign, x, yOffset }) — pure attr
   *                    update; the image moves freely along its anchor's
   *                    page without changing docPos.
   *   Cross-page drop → moveAndUpdateNode(newAnchorPos, { xAlign, x, yOffset: 0 })
   *                     — anchor relocates; yOffset resets so the image
   *                     lands at the new anchor's natural position.
   *
   * Drag math reads the gesture-begin snapshot (anchorGlobalY, startYOffset)
   * — never live layout. "Snapshot or die": if anchorGlobalY were
   * recomputed mid-drag, the image's vertical position would feed back
   * into the drag math and produce flicker / jumps.
   *
   * Pure no-op when total movement is below a small threshold (treats
   * the gesture as a click). Gap drops mirror the disabled overlay state.
   */
  private commitAnchoredDrag(e: MouseEvent): void {
    const { editor } = this.deps;
    if (!this.anchoredDrag) return;

    const dx = e.clientX - this.anchoredDrag.startClientX;
    const dy = e.clientY - this.anchoredDrag.startClientY;

    const DRAG_THRESHOLD = 3;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return;
    }

    // Drop in inter-page gap → no transaction. The ghost was already shown
    // disabled during mousemove; commit must mirror that.
    const finalHit = this.hitTest(e.clientX, e.clientY);
    if (finalHit?.gap) {
      dragDebugLog(editor, "gapDrop", {
        docPos: this.anchoredDrag.docPos,
        page: finalHit.page,
      });
      return;
    }

    const { docPos, startYOffset } = this.anchoredDrag;
    const sourcePage = this.anchoredDrag.rect.page;
    const samePage = !finalHit || finalHit.page === sourcePage;

    // Resolve horizontal target X. For modes whose horizontal placement is
    // user-controlled (square / top-bottom / behind / front) this updates
    // structural attrs so layout reflows around the new rectangle.
    const newX = this.resolveDragTargetX(dx);
    const horizontallyStill =
      newX === null || Math.abs(newX - this.anchoredDrag.startImageX) < 1;

    if (samePage) {
      // Same-page drag: yOffset commit, no docPos change. The anchor
      // paragraph stays where it is; the image translates freely on its
      // page (clamped by layout to the anchor's page bounds).
      // Y_THRESHOLD matches the X HORIZONTAL_THRESHOLD so a "pure horizontal"
      // drag with mouse jitter doesn't write a spurious yOffset.
      const Y_THRESHOLD = 3;
      const newYOffset = startYOffset + dy;
      const verticallyStill = Math.abs(dy) < Y_THRESHOLD;

      if (horizontallyStill && verticallyStill) {
        dragDebugLog(editor, "clampedNoMove", {
          docPos,
          attemptedX: newX,
          startImageX: this.anchoredDrag.startImageX,
          attemptedYOffset: newYOffset,
          startYOffset,
        });
        return;
      }

      const attrs: Record<string, unknown> = {};
      if (!horizontallyStill && newX !== null) {
        attrs["xAlign"] = "custom";
        attrs["x"] = newX;
      }
      if (!verticallyStill) {
        attrs["yOffset"] = newYOffset;
      }
      editor.setNodeAttrs(docPos, attrs);
      dragDebugLog(editor, "commit", {
        commitPath: "setNodeAttrs",
        docPos,
        newX,
        newYOffset,
      });
      return;
    }

    // Cross-page drop: anchor must relocate. Resolve a new anchor docPos
    // on the destination page; reset yOffset so the image lands at the new
    // anchor's natural position. Preserving exact visual position across
    // page breaks (= adjusted yOffset against new anchor) is deferred —
    // it requires a pageStartGlobal helper not yet exposed to PointerController.
    const newDocPos = this.resolveDragTargetDocPos(e);
    const { nodeSize } = this.anchoredDrag;
    const verticallyStill =
      newDocPos === null || (newDocPos >= docPos && newDocPos <= docPos + nodeSize);

    if (horizontallyStill && verticallyStill) {
      dragDebugLog(editor, "clampedNoMove", {
        docPos,
        attemptedX: newX,
        attemptedDocPos: newDocPos,
        crossPage: true,
      });
      return;
    }

    let commitPath: "moveAndUpdateNode" | "moveNode" | "setNodeAttrs";
    if (!horizontallyStill && !verticallyStill && newX !== null && newDocPos !== null) {
      editor.moveAndUpdateNode(docPos, newDocPos, {
        xAlign: "custom",
        x: newX,
        yOffset: 0,
      });
      commitPath = "moveAndUpdateNode";
    } else if (!verticallyStill && newDocPos !== null) {
      editor.moveAndUpdateNode(docPos, newDocPos, { yOffset: 0 });
      commitPath = "moveAndUpdateNode";
    } else if (newX !== null) {
      editor.setNodeAttrs(docPos, { xAlign: "custom", x: newX });
      commitPath = "setNodeAttrs";
    } else {
      return;
    }

    dragDebugLog(editor, "commit", { commitPath, docPos, newX, newDocPos, crossPage: true });
  }

  /**
   * Resolve the new content-area-relative X for the image. Returns
   * `null` when horizontal movement is too small to constitute a
   * structural change.
   *
   * The new X is computed as the image's start X plus the cursor's
   * horizontal delta, then clamped so the image stays inside the
   * content area. `xAlign` is set to `"custom"` by the caller so
   * layout reads `x` directly.
   */
  private resolveDragTargetX(dx: number): number | null {
    const { editor } = this.deps;
    if (!this.anchoredDrag) return null;
    const HORIZONTAL_THRESHOLD = 3;
    if (Math.abs(dx) < HORIZONTAL_THRESHOLD) return null;

    const node = editor.getState().doc.nodeAt(this.anchoredDrag.docPos);
    if (!node) return null;

    const { pageWidth, margins } = editor.layout.pageConfig;
    const contentX = margins.left;
    const contentWidth = pageWidth - margins.left - margins.right;
    const attrs = normalizeImageAttrs(node);

    const proposedX = this.anchoredDrag.startImageX + dx;
    // Clamp so the image stays inside the content area.
    const clampedX = Math.max(
      contentX,
      Math.min(proposedX, contentX + contentWidth - attrs.width),
    );
    return clampedX;
  }

  /**
   * Resolve the new docPos for the image based on the painted Y.
   * Returns `null` when the painted Y still resolves to the source
   * paragraph (no structural change needed).
   */
  private resolveDragTargetDocPos(e: MouseEvent): number | null {
    if (!this.anchoredDrag) return null;
    return this.resolveDragTargetDocPosFrom(e, this.anchoredDrag);
  }

  private resolveDragTargetDocPosFrom(
    e: MouseEvent,
    drag: {
      docPos: number;
      nodeSize: number;
      rect: { x: number; y: number; width: number; height: number; page: number };
      startClientY: number;
    },
  ): number | null {
    const { editor } = this.deps;

    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) return null;
    // Step 4 invariant: gap drops never resolve a docPos.
    if (hit.gap) return null;

    // Cross-page drag: charMap's posAtCoords is page-scoped — `nearestLine`
    // returns undefined on un-populated pages and the lookup falls through
    // to docPos 0, which would move the image to the document's start.
    // Force-populate the destination page before resolving.
    editor.ensurePagePopulated(hit.page);

    const { docPos, nodeSize } = drag;
    const from = docPos;
    const to = docPos + nodeSize;

    let pos = editor.charMap.posAtCoords(hit.docX, hit.docY, hit.page);
    // If the resolved docPos falls inside the source node itself
    // (we're still hovering over the original anchor), use posAbove /
    // posBelow with the image's center X to find the nearest
    // paragraph in the drag direction.
    if (pos >= from && pos <= to) {
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dy) < 1) return null; // pure horizontal — no docPos change
      const probeX = drag.rect.x + drag.rect.width / 2;
      const fallback = dy >= 0
        ? editor.charMap.posBelow(from, probeX)
        : editor.charMap.posAbove(from, probeX);
      if (fallback === null || fallback === undefined) return null;
      pos = fallback;
    } else if (pos === 0 && from !== 0) {
      // Cross-page failure: posAtCoords returned 0 because the destination
      // page has no charMap data (virtualized page that paintContent hasn't
      // touched yet). Walk layout.pages by Y range so cross-page drag never
      // silently collapses to docPos 0 and moves the image to doc start.
      const layoutFallback = this.resolveByLayoutFragments(hit.page, hit.docY);
      if (layoutFallback !== null) pos = layoutFallback;
    }

    if (pos === from) return null;
    return pos;
  }

  /**
   * Last-resort docPos resolver for cross-page drag. Walks the destination
   * page's layout blocks and returns the start-of-content docPos for the
   * block whose Y range contains `docY`, or for the nearest block when no
   * block strictly contains the point. Returns null on pages with no blocks.
   */
  private resolveByLayoutFragments(pageNumber: number, docY: number): number | null {
    const layout = this.deps.editor.layout;
    const pages = layout.pages;
    if (!pages || pages.length === 0) return null;
    const page = pages[pageNumber - 1];
    if (!page || page.blocks.length === 0) return null;

    let best: { block: typeof page.blocks[number]; distance: number } | null = null;
    for (const block of page.blocks) {
      const top = block.y;
      const bottom = block.y + block.height;
      if (docY >= top && docY <= bottom) {
        // Exact hit — return the start of this block's content.
        return block.nodePos + 1;
      }
      const distance = docY < top ? top - docY : docY - bottom;
      if (!best || distance < best.distance) best = { block, distance };
    }

    return best ? best.block.nodePos + 1 : null;
  }

  /**
   * Refresh the live drag overlay state (ghost rect + insertion caret) from
   * the current mouse position. Paint-only: never mutates layout, never
   * affects hit testing.
   */
  private updateAnchoredDragOverlay(e: MouseEvent): void {
    if (!this.anchoredDrag) return;
    const { editor } = this.deps;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (!hit) return;

    // Ghost top-left = current cursor minus the grab offset captured at
    // mousedown. Stays anchored to where the user originally grabbed.
    const ghostX = hit.docX - this.anchoredDrag.grabOffsetX;
    const ghostY = hit.docY - this.anchoredDrag.grabOffsetY;

    // Inter-page gap: invalid drop target. Keep the ghost rendered (so the
    // user sees what they're dragging) but mark disabled so the renderer
    // fades it and suppresses the caret.
    if (hit.gap) {
      this.anchoredDrag.overlay = {
        ghostPage: hit.page,
        ghostX,
        ghostY,
        caret: null,
        disabled: true,
      };
      this.setCursorAll("not-allowed");
      return;
    }

    // Resolve the insertion caret on the destination page. Populate the
    // page first — same reason as resolveDragTargetDocPos: posAtCoords is
    // page-scoped and falls through to docPos 0 on un-populated pages.
    editor.ensurePagePopulated(hit.page);
    let caret: { page: number; x: number; y: number; height: number } | null = null;
    const targetDocPos = editor.charMap.posAtCoords(hit.docX, hit.docY, hit.page);
    const from = this.anchoredDrag.docPos;
    const to = from + this.anchoredDrag.nodeSize;
    // Suppress the caret when the cursor is over the source node itself —
    // the user clearly hasn't picked a real drop target yet.
    if (targetDocPos < from || targetDocPos > to) {
      const coords = editor.charMap.coordsAtPos(targetDocPos, hit.page);
      if (coords) {
        caret = { page: coords.page, x: coords.x, y: coords.y, height: coords.height };
      }
    }

    this.anchoredDrag.overlay = {
      ghostPage: hit.page,
      ghostX,
      ghostY,
      caret,
      disabled: false,
    };
    // Restore the move cursor in case we just exited a gap.
    this.setCursorAll("move");
  }

  private setCursorAll(cursor: string): void {
    this.deps.tilesContainer.style.cursor = cursor;
    for (const entry of this.deps.pool) {
      entry.wrapper.style.cursor = cursor;
    }
  }

}
