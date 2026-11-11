import type { Editor } from "../Editor";
import { NodeSelection } from "prosemirror-state";
import type { SelectionGesture } from "../selection/types";
import {
  getHandles,
  hitHandle,
  computeNewSize,
} from "./ResizeController";
import type { Node as PmNode } from "prosemirror-model";
import { anchoredOf, placementAttrs, type AnchoredObjectPlacement, type PlacementPatch } from "../layout/AnchoredObjects";
import type { LaidRegion, LayoutBlock } from "../layout/BlockLayout";
import type { PointOwner } from "../layout/pointOwnership";
import { resolvePagePoint, type PagePoint } from "../layout/pagePoint";
import { inPopover } from "../hover/types";
import {
  type PageFlowMetrics,
} from "../layout/PageMetrics";
import { dragDebugLog } from "./DragDebugOverlay";

/**
 * How close to the rect edge the pointer must be for a resize-handle hit to
 * register. Pointers further inside than this fall through to body-drag
 * hit-testing — without it, an image bigger than ~24px would have no
 * surface available for body drag because resize-handle hit areas would
 * fully cover the rect via getHandles' 8-point grid.
 */
const EDGE_BAND_PX = 12;
const DRAG_THRESHOLD_PX = 3;
const AXIS_STILL_THRESHOLD_PX = 3;
const RE_ANCHOR_THRESHOLD_PX = 24;

/** `KeyboardEvent.key` for a modifier pressed on its own: the UI Events modifier keys, and Firefox's older "OS". */
const MODIFIER_KEYS = new Set([
  "Alt", "AltGraph", "CapsLock", "Control", "Fn", "FnLock", "Hyper", "Meta", "NumLock",
  "ScrollLock", "Shift", "Super", "Symbol", "SymbolLock", "OS",
]);

/**
 * The image's painted offset from its anchor. That is the user's `yOffset`
 * unless the solver moved the image — clamped onto the page or stacked below
 * another float — in which case it is where the image actually is.
 */
function paintedYOffset(placement: AnchoredObjectPlacement): number {
  const moved = placement.clamped === true || placement.stackOffset !== undefined;
  return moved ? placement.globalY - placement.anchorGlobalY : (anchoredOf(placement.node)?.yOffset ?? 0);
}

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
  scheduleUpdate: () => void;
  /**
   * Called before default text-selection on a page click. If the handler
   * returns true, the click is consumed (e.g. chrome band activation or
   * cursor positioning within an active surface).
   */
  onPageClick?: (point: PagePoint, clickCount: number) => boolean;
}

/**
 * PointerController — owns all pointer interaction logic for TileManager.
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
    /** Pointer position at drag start, in client coordinates. */
    startClientX: number;
    startClientY: number;
    /** Image's painted X at drag start, in page-local coordinates. */
    startImageX: number;
    /** The dragged node: its declaration writes the placement a drop commits. */
    node: PmNode;
    /**
     * Anchor flow's globalY snapshot. Frozen at pointerdown — never recomputed
     * during the gesture. Phase 2 spec ("snapshot or die"): drag math reads
     * the snapshot, never live layout, otherwise feedback loops re-create the
     * docPos-mutation drag bug.
     */
    anchorGlobalY: number;
    /** Image's painted globalY at gesture start. Used to derive yOffset on commit. */
    startImageGlobalY: number;
    /**
     * Where the image paints relative to its anchor at pointerdown. A drop
     * commits this plus the drag, so the image lands where it was dropped;
     * stacking re-applies only if it still overlaps another float.
     */
    startYOffset: number;
    /** wrapMode at pointerdown. */
    wrapMode: string;
    /** The composite region (a table cell) the image is laid out in at pointerdown; absent in the body. */
    regionPos?: number;
    /** Image's docPos rect at drag start (for posBelow / posAbove fallback). */
    rect: { x: number; y: number; width: number; height: number; page: number };
    /** Pointer position relative to the image's top-left at pointerdown. */
    grabOffsetX: number;
    grabOffsetY: number;
    /** Live overlay state — refreshed on pointermove, read by TileManager. */
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
       * inter-page gaps). Renderer fades the ghost; pointerup commits a no-op.
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
    overlay: {
      ghostPage: number;
      ghostX: number;
      ghostY: number;
      caret: { page: number; x: number; y: number; height: number } | null;
      disabled: boolean;
    };
  } | null = null;

  /** Active pointer capture. Null when hover/click handling is idle. */
  private activePointerId: number | null = null;
  /** Click-count tracking for double/triple-click. */
  private clickCount = 0;
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  /** Word boundaries from double-click — used for word-granularity drag. */
  private wordAnchor: { from: number; to: number } | null = null;
  /**
   * An extension-owned drag (e.g. table cell selection) that claimed this
   * pointerdown via the gesture registry. When set, moves/up/cancel route to it
   * instead of the built-in text/image handling. Transient — never editor state.
   */
  private activeGesture: SelectionGesture | null = null;
  /**
   * Cursor currently written to the DOM. Pointer moves fire continuously and
   * most of them stay inside one region; re-writing the same value on every
   * one of them is pure style churn.
   */
  private appliedCursor: string | null = null;
  /** Hover resolution is coalesced to one per animation frame. */
  private hoverRaf: number | null = null;
  private pendingHoverPoint: PagePoint | null = null;

  constructor(private readonly deps: PointerControllerDeps) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Attach pointer event listeners. */
  attach(): void {
    this.deps.tilesContainer.addEventListener("pointerdown", this.handlePointerDown);
    this.deps.tilesContainer.addEventListener("pointerleave", this.handlePointerLeave);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("pointerup", this.handlePointerUp);
    document.addEventListener("pointercancel", this.handlePointerCancel);
  }

  /** Detach pointer event listeners. */
  detach(): void {
    // Abort an in-flight extension gesture so teardown mid-drag doesn't leak
    // pointer capture or leave the gesture believing it's still live.
    const gesture = this.activeGesture;
    this.activeGesture = null;
    if (this.activePointerId !== null) {
      this.releasePointer(this.activePointerId);
      this.activePointerId = null;
    }
    if (gesture) {
      try {
        gesture.cancel();
      } catch {
        // A broken gesture must not block listener teardown.
      }
    }
    this.clearHover();
    this.deps.tilesContainer.removeEventListener("pointerdown", this.handlePointerDown);
    this.deps.tilesContainer.removeEventListener("pointerleave", this.handlePointerLeave);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerUp);
    document.removeEventListener("pointercancel", this.handlePointerCancel);
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
   * Live drag overlay state during an image drag. Read by
   * TileManager.paintOverlay to render a translucent ghost of the image
   * at the cursor position and a caret marker at the resolved insertion
   * point. Returns null when no image drag is in progress.
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
    const drag = this.anchoredDrag ?? this.inlineImageDrag;
    if (!drag) return null;
    return {
      sourcePage: drag.rect.page,
      sourceX: drag.rect.x,
      sourceY: drag.rect.y,
      width: drag.rect.width,
      height: drag.rect.height,
      ghostPage: drag.overlay.ghostPage,
      ghostX: drag.overlay.ghostX,
      ghostY: drag.overlay.ghostY,
      caret: drag.overlay.caret,
      disabled: drag.overlay.disabled,
    };
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  /**
   * Client point → page point. Drag callers treat `region === "gap"` as an
   * invalid drop target (no transaction, no caret); text-click callers still
   * get a `y` clamped to the page bottom there, so "click below the text on a
   * page" keeps working.
   */
  private hitTest(clientX: number, clientY: number): PagePoint {
    const containerRect = this.deps.tilesContainer.getBoundingClientRect();
    return resolvePagePoint(clientX, clientY, {
      origin: containerRect,
      pageless: this.deps.isPageless(),
      slotHeight: this.deps.slotHeight(),
      tileHeight: this.deps.tileHeight(),
      layout: this.deps.editor.layout,
    });
  }

  /** Get the ProseMirror selection from the active editing target (surface or body). */
  private activeSelection() {
    const { editor } = this.deps;
    return editor.surfaces?.activeSurface?.state.selection ?? editor.getState().selection;
  }

  private hitHandleAt(canvasX: number, canvasY: number, page: number) {
    const { editor } = this.deps;
    const sel = this.activeSelection();
    if (!(sel instanceof NodeSelection)) return null;
    // Any node is resizable, not just images: its SelectionBehavior must report
    // the `resize` capability (also gates read-only) and the node must carry
    // numeric width/height attrs to drive the drag. An extension's node that
    // draws resize handles + declares `resize: true` gets grab/ghost/commit free.
    if (!editor.describeSelection(sel).capabilities.resize) return null;
    if (
      typeof sel.node.attrs["width"] !== "number" ||
      typeof sel.node.attrs["height"] !== "number"
    )
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

    // Resize hit-testing uses the canonical 8-point `getHandles(nodeRect)` grid.
    // A behavior's `geometry()` paints its grips from the *same* `getHandles`
    // over the *same* `editor.getNodeRect`, so paint and hit-test share one
    // source of truth — the contract for `resize: true` is exactly these 8
    // positions. A behavior that wants bespoke handle geometry can't express it
    // yet (the emitted `handles` primitives carry no id to drive the drag);
    // that lands with the resize → standalone gesture-provider refactor.
    return hitHandle(canvasX, canvasY, getHandles(r.x, r.y, r.width, r.height));
  }

  /**
   * Who owns this point — the one answer click routing, hover and drags all
   * read, so they cannot disagree about it. See `resolvePointOwner`.
   */
  private ownerAt(docX: number, docY: number, page: number): PointOwner {
    return this.deps.editor.pointOwnerAt(docX, docY, page);
  }

  /**
   * The cursor for a hover position: a resize handle's own cursor, `text` over
   * text, `move` over an object.
   *
   * Resize handles sit above ownership — they are chrome painted over the
   * selected node, not part of the page.
   */
  private hoverCursorFor(hit: PagePoint): string {
    const resizeHit = this.hitHandleAt(hit.x, hit.y, hit.page);
    if (resizeHit) return resizeHit.cursor;

    return this.ownerAt(hit.x, hit.y, hit.page).kind === "text" ? "text" : "move";
  }


  // ── Hover ───────────────────────────────────────────────────────────────────

  /**
   * Resolve what is under `point` on the next frame and report it to the
   * editor, which emits `"hover"` only when the stack changed. Pointer moves
   * arrive far faster than frames; only the last point in a frame matters.
   */
  private scheduleHover(point: PagePoint): void {
    this.pendingHoverPoint = point;
    if (this.hoverRaf !== null) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = null;
      const p = this.pendingHoverPoint;
      this.pendingHoverPoint = null;
      if (!p) return;
      const { editor } = this.deps;
      editor.reportHover({ targets: editor.resolveHoverTargets(p), point: p });
    });
  }

  /**
   * Nothing is hovered: the pointer left the editor, a drag began, a key was
   * pressed (typing hides peeks until the next real move), or teardown.
   */
  private clearHover = (dismissed = false): void => {
    if (this.hoverRaf !== null) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = null;
    }
    this.pendingHoverPoint = null;
    this.deps.editor.reportHover({ targets: [], point: null, ...(dismissed ? { dismissed } : {}) });
  };

  /** Leaving the page onto a popover keeps what the popover serves hovered. */
  private handlePointerLeave = (e: PointerEvent): void => {
    if (inPopover(e.relatedTarget instanceof Element ? e.relatedTarget : null)) return;
    this.clearHover();
  };

  /**
   * Typing or Escape in the editor dismisses peeks. A modifier alone is not
   * typing — it is how a shortcut, or a Cmd/Ctrl-click on the hovered link,
   * begins.
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (MODIFIER_KEYS.has(e.key)) return;
    // Keys inside a popover use the popover — Tab to its link, copy its URL.
    if (inPopover(e.target instanceof Element ? e.target : null)) return;
    this.clearHover(true);
  };

  // ── Pointer events ──────────────────────────────────────────────────────────

  private handlePointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    // While any drag is in flight, a second pointerdown must NOT re-enter
    // hit-testing — otherwise an accidental
    // double-click during drag fires two PM transactions, or text selection
    // resolves at a stale point.
    if (
      this.activePointerId !== null ||
      this.isDragging ||
      this.resizeDrag ||
      this.anchoredDrag ||
      this.inlineImageDrag
    ) {
      return;
    }
    const { editor } = this.deps;
    const hit = this.hitTest(e.clientX, e.clientY);
    // A press ends hover: it either places a caret (the selection's popover
    // takes over) or starts a drag.
    this.clearHover();
    this.activePointerId = e.pointerId;
    this.capturePointer(e.pointerId);

    const { page, x: docX, y: docY } = hit;

    // Count clicks before resolving a semantic target. Registered gestures get
    // first refusal for every pointerdown (including Shift/double/triple-click
    // and points over built-in images); built-in text/image behavior is only the
    // compatibility fallback when no provider claims the target.
    const now = Date.now();
    const CLICK_TIMEOUT = 500;
    const CLICK_RADIUS = 5;
    if (
      now - this.lastClickTime < CLICK_TIMEOUT &&
      Math.abs(e.clientX - this.lastClickX) < CLICK_RADIUS &&
      Math.abs(e.clientY - this.lastClickY) < CLICK_RADIUS
    ) {
      this.clickCount++;
    } else {
      this.clickCount = 1;
    }
    this.lastClickTime = now;
    this.lastClickX = e.clientX;
    this.lastClickY = e.clientY;

    // Before any routing, and in read-only too: what is painted over a page
    // without being a document node — a sealed field — hears presses here.
    if (e.button === 0) editor.emit("press", { point: hit, clickCount: this.clickCount });

    // Chrome bands are separate editing surfaces, so their activation routing
    // precedes body hit testing.
    if (!editor.readOnly && this.deps.onPageClick?.(hit, this.clickCount)) return;

    // An image painted over the point owns it, as the hover cursor promised;
    // resize handles are chrome over the selected node. Either outranks the
    // block underneath, a table cell included. Ownership already gives a
    // table's cells the points over a behind image.
    const owner = this.ownerAt(docX, docY, page);
    const resizeHit = this.hitHandleAt(docX, docY, page);
    const paintedOver = owner.kind === "anchored" && owner.object.wrapMode !== "behind";
    const semanticHit = paintedOver || resizeHit ? null : editor.resolveHitTarget(docX, docY, page);
    if (semanticHit) {
      // Pass the authoritative click count — `event.detail` isn't reliable on
      // pointerdown, so a gesture that treats double/triple-click specially (a
      // cell gesture defers to word/block selection) needs this instead.
      const gesture = editor.beginSelectionGesture(semanticHit, e, this.clickCount);
      if (gesture) {
        this.activeGesture = gesture;
        this.isDragging = true;
        return;
      }
    }

    // Resize handle — mutation, block in read-only
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
    // `owner` is resolved once for this pointerdown, so the anchored and
    // inline branches cannot reach different conclusions about the same point.
    const anchoredHit = owner.kind === "anchored" ? owner.object : null;
    if (anchoredHit) {
      if (editor.readOnly) return;
      editor.selectNode(anchoredHit.docPos);
      // Pointer position relative to the image's top-left at pointerdown — used
      // by pointermove to keep the ghost rect anchored to the cursor's grab
      // point (so the image doesn't snap to the cursor's top-left).
      const grabOffsetX = docX - anchoredHit.x;
      const grabOffsetY = docY - anchoredHit.y;
      this.anchoredDrag = {
        docPos: anchoredHit.docPos,
        nodeSize: anchoredHit.node.nodeSize,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startImageX: anchoredHit.x,
        node: anchoredHit.node,
        anchorGlobalY: anchoredHit.anchorGlobalY,
        startImageGlobalY: anchoredHit.globalY,
        startYOffset: paintedYOffset(anchoredHit),
        wrapMode: anchoredHit.wrapMode,
        ...(anchoredHit.regionPos !== undefined ? { regionPos: anchoredHit.regionPos } : {}),
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

    this.isDragging = true;
    const pos = editor.charMap.posAtCoords(docX, docY, page);

    // Triple-click → select entire block
    if (this.clickCount >= 3) {
      this.wordAnchor = null;
      editor.selection.selectBlockAt(pos);
      return;
    }

    // Double-click → select word (and enable word-granularity drag)
    if (this.clickCount === 2) {
      const bounds = editor.selection.selectWordAt(pos);
      this.wordAnchor = bounds;
      return;
    }

    this.wordAnchor = null;

    if (!e.shiftKey) {
      // Click physically inside an inline image's rect → select the image.
      if (!editor.readOnly) {
        const imageHit = owner.kind === "inlineObject" ? owner.rect : null;
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
              overlay: {
                ghostPage: imageHit.page,
                ghostX: imageHit.x,
                ghostY: imageHit.y,
                caret: null,
                disabled: false,
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

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.acceptsPointer(e)) return;
    if (this.activePointerId !== null) e.preventDefault();
    const { editor } = this.deps;

    // Extension gesture owns the drag — feed it the target under the cursor.
    if (this.activeGesture) {
      this.clearHover();
      const h = this.hitTest(e.clientX, e.clientY);
      const target = editor.resolveHitTarget(h.x, h.y, h.page);
      const point = { page: h.page, docX: h.x, docY: h.y };
      try {
        this.activeGesture.update(target, e, point);
      } catch (err) {
        // A throwing gesture must not lock the pointer for the rest of the session.
        this.endActiveGesture(e.pointerId);
        throw err;
      }
      return;
    }

    // Resize drag — buffer pending size; commit only on pointerup
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
    // resolve the live insertion caret. Deltas commit on pointerup; this block
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
      this.updateInlineImageDragOverlay(e);
      this.setCursorAll("move");
      this.deps.scheduleUpdate();
      return;
    }

    // Hover cursor — resolved on every move, including moves that leave the
    // page. Skipping the update when nothing is hit left the last cursor
    // frozen on screen, so crossing from text to image (or off the page
    // entirely) kept promising whatever the previous position offered.
    const hit = this.hitTest(e.clientX, e.clientY);
    this.setCursorAll(this.hoverCursorFor(hit));

    // Hover: mouse and pen only — touch reaches the same popovers through the
    // selection. Any press in flight means a drag, and a drag hovers nothing.
    // Over a popover, the stack stays as it was so the peek the pointer is
    // crossing into stays open; anywhere else off the page area hovers nothing.
    const target = e.target instanceof Element ? e.target : null;
    if (!inPopover(target)) {
      const hovers =
        !this.isDragging &&
        this.activePointerId === null &&
        e.pointerType !== "touch" &&
        target !== null &&
        this.deps.tilesContainer.contains(target);
      if (hovers) this.scheduleHover(hit);
      else this.clearHover();
    }

    // Text selection drag
    if (!this.isDragging) return;
    // Mid-drag in the gap between two pages: the region is "gap" and hit.y
    // is clamped to the source page bottom. Letting posAtCoords run on that
    // would re-collapse the selection's head to end-of-source-page on every
    // frame of gap traversal. Skip the update — the last valid selection
    // sticks until the pointer enters real page content again.
    if (hit.region === "gap") return;
    // posAtCoords is page-scoped: on a destination page that hasn't been
    // painted yet, its CharacterMap has no lines, the lookup falls through
    // to 0, and setSelection(anchor, 0) collapses the selection to doc
    // start — visually "stuck at the source page" because the destination
    // half never gets a valid head. Populate the page first, same as the
    // anchored-object drag handler below.
    editor.ensurePagePopulated(hit.page);

    const pos = editor.charMap.posAtCoords(hit.x, hit.y, hit.page);

    // Word-granularity drag (after double-click)
    if (this.wordAnchor) {
      const { from: wFrom, to: wTo } = this.wordAnchor;
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

  private handlePointerUp = (e: PointerEvent): void => {
    if (!this.acceptsPointer(e)) return;
    e.preventDefault();
    const { editor } = this.deps;
    if (this.activeGesture) {
      const gesture = this.activeGesture;
      // Clear first so a throwing finish() can't leave the gesture stuck active.
      this.activeGesture = null;
      this.isDragging = false;
      const h = this.hitTest(e.clientX, e.clientY);
      const target = editor.resolveHitTarget(h.x, h.y, h.page);
      const point = { page: h.page, docX: h.x, docY: h.y };
      try {
        gesture.finish(target, e, point);
      } finally {
        this.releasePointer(e.pointerId);
        this.activePointerId = null;
      }
      return;
    }
    if (this.resizeDrag) {
      const { docPos, pendingWidth, pendingHeight } = this.resizeDrag;
      // A node that declares its placement stores its size there; any other
      // object is sized by its width and height attrs, as layout reads it.
      const node = editor.getState().doc.nodeAt(docPos);
      const size = { width: pendingWidth, height: pendingHeight };
      editor.setNodeAttrs(docPos, (node && placementAttrs(node, size)) ?? size);
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
    this.releasePointer(e.pointerId);
    this.activePointerId = null;
  };

  private handlePointerCancel = (e: PointerEvent): void => {
    if (!this.acceptsPointer(e)) return;
    // Reset all state first, then notify the gesture — a throwing cancel() must
    // not skip teardown.
    const gesture = this.activeGesture;
    this.activeGesture = null;
    this.resizeDrag = null;
    this.anchoredDrag = null;
    this.inlineImageDrag = null;
    this.isDragging = false;
    this.setCursorAll("text");
    this.releasePointer(e.pointerId);
    this.activePointerId = null;
    this.deps.scheduleUpdate();
    if (gesture) {
      try {
        gesture.cancel();
      } catch {
        // Teardown already done; a broken gesture's cancel must not propagate here.
      }
    }
  };

  /** Drop the active gesture and release the pointer (used when a gesture throws). */
  private endActiveGesture(pointerId: number): void {
    this.activeGesture = null;
    this.isDragging = false;
    this.releasePointer(pointerId);
    this.activePointerId = null;
  }

  private acceptsPointer(e: PointerEvent): boolean {
    return this.activePointerId === null || e.pointerId === this.activePointerId;
  }

  private capturePointer(pointerId: number): void {
    const el = this.deps.tilesContainer;
    if (typeof el.setPointerCapture !== "function") return;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // Capture can fail if the pointer is already gone; document listeners
      // still keep the gesture coherent in tests and older environments.
    }
  }

  private releasePointer(pointerId: number): void {
    const el = this.deps.tilesContainer;
    if (typeof el.releasePointerCapture !== "function") return;
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      // Already released/cancelled; nothing else to clean up.
    }
  }

  private commitInlineImageDrag(e: PointerEvent): void {
    const { editor } = this.deps;
    if (!this.inlineImageDrag) return;

    const dx = e.clientX - this.inlineImageDrag.startClientX;
    const dy = e.clientY - this.inlineImageDrag.startClientY;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;

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
  private commitAnchoredDrag(e: PointerEvent): void {
    const { editor } = this.deps;
    if (!this.anchoredDrag) return;

    const dx = e.clientX - this.anchoredDrag.startClientX;
    const dy = e.clientY - this.anchoredDrag.startClientY;

    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
      return;
    }

    // Drop in inter-page gap → no transaction. The ghost was already shown
    // disabled during pointermove; commit must mirror that.
    const finalHit = this.hitTest(e.clientX, e.clientY);
    if (finalHit.region === "gap") {
      dragDebugLog(editor, "gapDrop", {
        docPos: this.anchoredDrag.docPos,
        page: finalHit.page,
      });
      return;
    }

    if (this.commitContainerChange(finalHit)) return;

    const { docPos, startYOffset } = this.anchoredDrag;
    const sourcePage = this.anchoredDrag.rect.page;
    const samePage = finalHit.page === sourcePage;

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
      // Matches the horizontal still threshold so a "pure horizontal" drag
      // with mouse jitter doesn't write a spurious yOffset.
      const newYOffset = startYOffset + dy;
      const verticallyStill = Math.abs(dy) < AXIS_STILL_THRESHOLD_PX;

      if (horizontallyStill && verticallyStill) {
        dragDebugLog(editor, "clampedNoMove", {
          docPos,
          attemptedX: newX,
          startImageX: this.anchoredDrag.startImageX,
          attemptedYOffset: newYOffset,
          startYOffset,
          wrapMode: this.anchoredDrag.wrapMode,
        });
        return;
      }

      const patch: PlacementPatch = {};
      if (!horizontallyStill && newX !== null) {
        patch.xAlign = "custom";
        patch.x = this.contentRelativeX(newX);
      }
      if (!verticallyStill) {
        patch.yOffset = newYOffset;
      }
      const reanchor = !verticallyStill
        ? this.resolveSamePageReanchor(newYOffset, patch)
        : null;
      if (reanchor) {
        this.movePlacement(docPos, reanchor.docPos, reanchor.patch);
        dragDebugLog(editor, "commit", {
          commitPath: "moveAndUpdateNode",
          docPos,
          newDocPos: reanchor.docPos,
          newX,
          newYOffset: reanchor.patch.yOffset,
          reanchor: true,
        });
        return;
      }
      this.setPlacement(docPos, patch);
      dragDebugLog(editor, "commit", {
        commitPath: "setNodeAttrs",
        docPos,
        newX,
        newYOffset,
      });
      return;
    }

    // Cross-page drop: anchor relocates, but the image keeps its exact visual
    // top by committing yOffset against the destination anchor's global Y.
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
    const drop = newDocPos !== null ? this.resolveCrossPageDrop(e, newDocPos) : null;
    const crossPageYOffset = drop?.yOffset ?? 0;

    if (!horizontallyStill && !verticallyStill && newX !== null && drop) {
      this.movePlacement(docPos, drop.docPos, {
        xAlign: "custom",
        x: this.contentRelativeX(newX),
        yOffset: crossPageYOffset,
      });
      commitPath = "moveAndUpdateNode";
    } else if (!verticallyStill && drop) {
      this.movePlacement(docPos, drop.docPos, { yOffset: crossPageYOffset });
      commitPath = "moveAndUpdateNode";
    } else if (newX !== null) {
      this.setPlacement(docPos, { xAlign: "custom", x: this.contentRelativeX(newX) });
      commitPath = "setNodeAttrs";
    } else {
      return;
    }

    dragDebugLog(editor, "commit", {
      commitPath,
      docPos,
      newX,
      newDocPos: drop?.docPos ?? newDocPos,
      newYOffset: crossPageYOffset,
      crossPage: true,
    });
  }

  /**
   * Resolve the new content-area-relative X for the image. Returns
   * `null` when horizontal movement is too small to constitute a
   * structural change.
   *
   * The new X is computed as the image's start X plus the cursor's
   * horizontal delta, then clamped to *page* bounds (Word-aligned: an
   * image dragged sideways may extend into the left/right margins but
   * cannot escape the page). `xAlign` is set to `"custom"` by the caller
   * so layout reads `x` directly.
   */
  private resolveDragTargetX(dx: number): number | null {
    const { editor } = this.deps;
    if (!this.anchoredDrag) return null;
    const HORIZONTAL_THRESHOLD = 3;
    if (Math.abs(dx) < HORIZONTAL_THRESHOLD) return null;

    // The painted width snapshotted at pointerdown, as the rest of the drag
    // reads its geometry.
    const { pageWidth } = editor.layout.pageConfig;
    const proposedX = this.anchoredDrag.startImageX + dx;
    const clampedX = Math.max(0, Math.min(proposedX, pageWidth - this.anchoredDrag.rect.width));
    return clampedX;
  }

  /**
   * A drop over a table cell anchors the image in that cell's paragraph
   * nearest the drop, laid out inside the cell as Word does; a drop outside
   * every table takes an image out of its cell into the body. In both, the
   * image lands where it was dropped. Returns false only for a body image
   * dropped in the body, which the body's own drop rules handle.
   */
  private commitContainerChange(hit: PagePoint): boolean {
    if (!this.anchoredDrag) return false;
    const { editor } = this.deps;
    const { docPos, grabOffsetX, grabOffsetY } = this.anchoredDrag;
    const ghostX = hit.x - grabOffsetX;
    const ghostY = hit.y - grabOffsetY;
    const ownParagraph = editor.getState().doc.resolve(docPos).start();

    const target = this.regionAt(hit.page, hit.x, hit.y);
    if (target) {
      // A region with no paragraph (only a nested composite) cannot take the image.
      const paragraph = nearestRegionParagraph(target.unit, target.region, ghostY);
      if (!paragraph) return true;
      const patch: PlacementPatch = {
        xAlign: "custom",
        x: ghostX - (target.region.x + target.region.inset.left),
        yOffset: ghostY - (target.unit.y + paragraph.y),
      };
      const anchorPos = paragraph.nodePos + 1;
      if (anchorPos === ownParagraph) this.setPlacement(docPos, patch);
      else this.movePlacement(docPos, anchorPos, patch);
      dragDebugLog(editor, "commit", { commitPath: "region", docPos, newDocPos: anchorPos, regionPos: target.region.pos });
      return true;
    }

    if (this.anchoredDrag.regionPos === undefined) return false;
    // An image leaving its region needs a body paragraph on the drop page; with
    // none, the drop does nothing rather than move it inside its region.
    const ghostGlobalY = this.pageLocalYToGlobal(hit.page, ghostY);
    const nearest = this.nearestAnchorStartingOn(hit.page, ghostGlobalY, () => false);
    if (!nearest) return true;
    this.movePlacement(docPos, nearest.docPos, {
      xAlign: "custom",
      x: this.contentRelativeX(ghostX),
      yOffset: ghostGlobalY - nearest.globalY,
    });
    dragDebugLog(editor, "commit", { commitPath: "leaveRegion", docPos, newDocPos: nearest.docPos });
    return true;
  }

  /** Sets the dragged object's placement, written through its own declaration. */
  private setPlacement(docPos: number, patch: PlacementPatch): void {
    const attrs = this.anchoredDrag ? placementAttrs(this.anchoredDrag.node, patch) : null;
    if (attrs) this.deps.editor.setNodeAttrs(docPos, attrs);
  }

  /** Moves the dragged object to `to` with its placement, written through its own declaration. */
  private movePlacement(docPos: number, to: number, patch: PlacementPatch): void {
    const attrs = this.anchoredDrag ? placementAttrs(this.anchoredDrag.node, patch) : null;
    if (attrs) this.deps.editor.moveAndUpdateNode(docPos, to, attrs);
  }

  /**
   * A body image's custom `x` is measured from the content area's left edge,
   * Word's `relativeFrom="column"`; drag math works in page-local x.
   */
  private contentRelativeX(pageX: number): number {
    return pageX - this.deps.editor.layout.pageConfig.margins.left;
  }

  /** The innermost composite unit and region under a page-local point, if any. */
  private regionAt(pageNumber: number, x: number, y: number): { unit: LayoutBlock; region: LaidRegion } | null {
    return innermostRegion(this.deps.editor.layout.pages?.[pageNumber - 1]?.blocks ?? [], x, y, 0);
  }

  private resolveSamePageReanchor(
    committedYOffset: number,
    patch: PlacementPatch,
  ): { docPos: number; patch: PlacementPatch } | null {
    if (!this.anchoredDrag) return null;
    const sourcePage = this.anchoredDrag.rect.page;
    const imageGlobalY = this.anchoredDrag.anchorGlobalY + committedYOffset;
    // The image's own paragraph is where it is measured from already. A
    // locked image is measured from where that paragraph started when it
    // locked, not where its wrap has since moved it.
    const ownParagraph = this.deps.editor.getState().doc.resolve(this.anchoredDrag.docPos).start();
    const best = this.nearestAnchorStartingOn(sourcePage, imageGlobalY, (docPos) => docPos === ownParagraph);
    if (!best) return null;
    const wouldReduce = Math.abs(committedYOffset) - best.distance;
    if (wouldReduce <= RE_ANCHOR_THRESHOLD_PX) return null;
    return {
      docPos: best.docPos,
      patch: {
        ...patch,
        yOffset: imageGlobalY - best.globalY,
      },
    };
  }

  /**
   * Where a cross-page drop anchors and its offset from that anchor. The
   * paragraph under the drop keeps the image if it starts on the drop page;
   * one carried over from an earlier page gives way, as in Word, to the
   * nearest paragraph that starts on the drop page.
   */
  private resolveCrossPageDrop(e: PointerEvent, newDocPos: number): { docPos: number; yOffset: number } | null {
    if (!this.anchoredDrag) return null;
    const hit = this.hitTest(e.clientX, e.clientY);
    if (hit.region === "gap") return null;
    const ghostGlobalY = this.pageLocalYToGlobal(hit.page, hit.y - this.anchoredDrag.grabOffsetY);

    const { doc } = this.deps.editor.getState();
    const $pos = newDocPos <= doc.content.size ? doc.resolve(newDocPos) : null;
    const paragraph = $pos?.parent.isTextblock && $pos.depth > 0 ? this.anchorStartOf($pos.before()) : null;
    if (paragraph && paragraph.page === hit.page) {
      return { docPos: newDocPos, yOffset: ghostGlobalY - paragraph.globalY };
    }
    const nearest = this.nearestAnchorStartingOn(hit.page, ghostGlobalY, () => false);
    if (nearest) return { docPos: nearest.docPos, yOffset: ghostGlobalY - nearest.globalY };
    return paragraph ? { docPos: newDocPos, yOffset: ghostGlobalY - paragraph.globalY } : null;
  }

  /**
   * The global Y layout measures an anchor in a paragraph from: the top of
   * the paragraph's first part, which is the anchor flow's start.
   */
  private anchorStartGlobalY(pageNumber: number, block: LayoutBlock): number {
    return this.pageLocalYToGlobal(pageNumber, block.y);
  }

  /** Where the paragraph at `nodePos` starts, as `anchorStartGlobalY` measures it. */
  private anchorStartOf(nodePos: number): { page: number; globalY: number } | null {
    for (const page of this.deps.editor.layout.pages ?? []) {
      const block = page.blocks.find((b) => b.nodePos === nodePos && !b.isContinuation);
      if (block) return { page: page.pageNumber, globalY: this.anchorStartGlobalY(page.pageNumber, block) };
    }
    return null;
  }

  /** The paragraph starting on `pageNumber` whose anchor start is nearest `globalY`. */
  private nearestAnchorStartingOn(
    pageNumber: number,
    globalY: number,
    skip: (docPos: number) => boolean,
  ): { docPos: number; globalY: number; distance: number } | null {
    let best: { docPos: number; globalY: number; distance: number } | null = null;
    for (const block of this.deps.editor.layout.pages?.[pageNumber - 1]?.blocks ?? []) {
      if (block.kind !== "text" || block.isContinuation) continue;
      const docPos = block.nodePos + 1;
      if (skip(docPos)) continue;
      const start = this.anchorStartGlobalY(pageNumber, block);
      const distance = Math.abs(globalY - start);
      if (!best || distance < best.distance) best = { docPos, globalY: start, distance };
    }
    return best;
  }

  private metricsForPage(pageNumber: number): PageFlowMetrics {
    const layout = this.deps.editor.layout;
    const metrics = layout.metrics?.[pageNumber - 1];
    if (metrics) return metrics;
    const fallbackContentHeight = typeof layout.pageConfig.pageHeight === "number"
      ? layout.pageConfig.pageHeight - layout.pageConfig.margins.top - layout.pageConfig.margins.bottom
      : 0;
    return {
      contentTop: layout.pageConfig.margins.top,
      contentHeight: fallbackContentHeight,
    };
  }

  private pageStartGlobal(pageNumber: number): number {
    const layout = this.deps.editor.layout;
    const starts = layout.pageStarts;
    // Pageless is one continuous flow — every page shares the first origin.
    if (layout.pageConfig.pageless) {
      return starts?.[0] ?? this.metricsForPage(1).contentTop;
    }

    const known = starts?.[pageNumber - 1];
    if (known !== undefined) return known;

    // Past the end of the laid-out range, which a partial layout mid-stream can
    // produce. Continue from the last known start using the same synthesized
    // page height metricsForPage() falls back to.
    const laidOut = starts?.length ?? 0;
    let y = laidOut > 0 ? starts![laidOut - 1]! : this.metricsForPage(1).contentTop;
    for (let page = Math.max(laidOut, 1); page < pageNumber; page++) {
      y += this.metricsForPage(page).contentHeight;
    }
    return y;
  }

  private pageLocalYToGlobal(pageNumber: number, localY: number): number {
    return (
      this.pageStartGlobal(pageNumber) +
      (localY - this.metricsForPage(pageNumber).contentTop)
    );
  }

  /**
   * Resolve the new docPos for the image based on the painted Y.
   * Returns `null` when the painted Y still resolves to the source
   * paragraph (no structural change needed).
   */
  private resolveDragTargetDocPos(e: PointerEvent): number | null {
    if (!this.anchoredDrag) return null;
    return this.resolveDragTargetDocPosFrom(e, this.anchoredDrag);
  }

  private resolveDragTargetDocPosFrom(
    e: PointerEvent,
    drag: {
      docPos: number;
      nodeSize: number;
      rect: { x: number; y: number; width: number; height: number; page: number };
      startClientY: number;
    },
  ): number | null {
    const { editor } = this.deps;

    const hit = this.hitTest(e.clientX, e.clientY);
    // Step 4 invariant: gap drops never resolve a docPos.
    if (hit.region === "gap") return null;

    // Cross-page drag: charMap's posAtCoords is page-scoped — `nearestLine`
    // returns undefined on un-populated pages and the lookup falls through
    // to docPos 0, which would move the image to the document's start.
    // Force-populate the destination page before resolving.
    editor.ensurePagePopulated(hit.page);

    const { docPos, nodeSize } = drag;
    const from = docPos;
    const to = docPos + nodeSize;

    let pos = editor.charMap.posAtCoords(hit.x, hit.y, hit.page);
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
      const layoutFallback = this.resolveByLayoutFragments(hit.page, hit.y);
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
   * the current pointer position. Paint-only: never mutates layout, never
   * affects hit testing.
   */
  private updateAnchoredDragOverlay(e: PointerEvent): void {
    if (!this.anchoredDrag) return;
    const { editor } = this.deps;
    const hit = this.hitTest(e.clientX, e.clientY);

    // Ghost top-left = current cursor minus the grab offset captured at
    // pointerdown. Stays anchored to where the user originally grabbed.
    const ghostX = hit.x - this.anchoredDrag.grabOffsetX;
    const ghostY = hit.y - this.anchoredDrag.grabOffsetY;

    // Inter-page gap: invalid drop target. Keep the ghost rendered (so the
    // user sees what they're dragging) but mark disabled so the renderer
    // fades it and suppresses the caret.
    if (hit.region === "gap") {
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
    const targetDocPos = editor.charMap.posAtCoords(hit.x, hit.y, hit.page);
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

  private updateInlineImageDragOverlay(e: PointerEvent): void {
    if (!this.inlineImageDrag) return;
    const { editor } = this.deps;
    const hit = this.hitTest(e.clientX, e.clientY);

    const ghostX = hit.x - this.inlineImageDrag.rect.width / 2;
    const ghostY = hit.y - this.inlineImageDrag.rect.height / 2;
    if (hit.region === "gap") {
      this.inlineImageDrag.overlay = {
        ghostPage: hit.page,
        ghostX,
        ghostY,
        caret: null,
        disabled: true,
      };
      this.setCursorAll("not-allowed");
      return;
    }

    editor.ensurePagePopulated(hit.page);
    let caret: { page: number; x: number; y: number; height: number } | null = null;
    const targetDocPos = editor.charMap.posAtCoords(hit.x, hit.y, hit.page);
    const from = this.inlineImageDrag.docPos;
    const to = from + this.inlineImageDrag.nodeSize;
    if (targetDocPos < from || targetDocPos > to) {
      const coords = editor.charMap.coordsAtPos(targetDocPos, hit.page);
      if (coords) {
        caret = { page: coords.page, x: coords.x, y: coords.y, height: coords.height };
      }
    }

    this.inlineImageDrag.overlay = {
      ghostPage: hit.page,
      ghostX,
      ghostY,
      caret,
      disabled: false,
    };
  }

  private setCursorAll(cursor: string): void {
    if (cursor === this.appliedCursor) return;
    this.appliedCursor = cursor;
    this.deps.tilesContainer.style.cursor = cursor;
    for (const entry of this.deps.pool) {
      entry.wrapper.style.cursor = cursor;
    }
  }

}

/**
 * The innermost region at a page-local point among `blocks` (their `y`
 * relative to `originY`), with its unit placed at its page-local top: a cell
 * of a table nested in a cell wins over its outer cell.
 */
function innermostRegion(
  blocks: readonly LayoutBlock[],
  x: number,
  y: number,
  originY: number,
): { unit: LayoutBlock; region: LaidRegion } | null {
  for (const block of blocks) {
    const unit = { ...block, y: originY + block.y };
    if (y < unit.y || y >= unit.y + unit.height) continue;
    const region = unit.regions?.find((r) => x >= r.x && x < r.x + r.width);
    if (region) return innermostRegion(region.blocks, x, y, unit.y) ?? { unit, region };
  }
  return null;
}

/** The paragraph in a region whose top is nearest a page-local y; an image anchors only in a textblock. */
function nearestRegionParagraph(unit: LayoutBlock, region: LaidRegion, y: number): LayoutBlock | null {
  let best: LayoutBlock | null = null;
  for (const block of region.blocks) {
    if (!block.node.isTextblock) continue;
    if (!best || Math.abs(unit.y + block.y - y) < Math.abs(unit.y + best.y - y)) best = block;
  }
  return best;
}
