/**
 * createImageMenu — framework-agnostic controller for an image toolbar popover.
 *
 * Shows in two presentations:
 *   - "full" when the active selection's descriptor kind is "image" (the kind
 *     the Image extension's SelectionBehavior reports) — the consumer renders
 *     resize / wrapping / margin controls.
 *   - "peek" when the pointer rests on an image, with `hover` on — compact and
 *     read-only. Off by default: Word, Docs and Pages show no card on hover.
 * Selection wins: while an image is selected, hover is ignored.
 *
 * Passes the image node, its doc position, and a viewport DOMRect to the
 * callbacks. The DOMRect covers the full visual bounds of the image (not
 * cursor-sized), so `rect.bottom` is a reliable anchor for a popover below it.
 *
 * @example — vanilla JS
 *   const cleanup = createImageMenu(editor, {
 *     onShow: (rect, info) => {
 *       toolbar.style.cssText = `display:flex;left:${rect.left}px;top:${rect.bottom + 8}px`;
 *       widthInput.value = String(info.node.attrs.width);
 *     },
 *     onHide: () => { toolbar.style.display = "none" },
 *     onMove: (rect) => {
 *       toolbar.style.left = `${rect.left}px`;
 *       toolbar.style.top  = `${rect.bottom + 8}px`;
 *     },
 *   });
 */
import type { Node } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { IEditor } from "../extensions/types";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";
import type { HoverTarget } from "../hover/types";
import {
  subscribeHoverTarget,
  type HoverOption,
  type PopoverPresentation,
} from "./subscribeHoverTarget";

export interface ImageMenuInfo {
  /** The image ProseMirror node (access attrs via info.node.attrs). */
  node: Node;
  /** Doc position of the image node — use with editor.selectNode() or transactions. */
  docPos: number;
  /** "peek" when shown from hover, "full" when the image is selected. */
  presentation: PopoverPresentation;
}

export interface ImageMenuCallbacks {
  /** Called when an image is selected, or hovered with `hover` on. Position the popover using rect. */
  onShow(rect: DOMRect, info: ImageMenuInfo): void;
  /** Called when the selection leaves the image, or a peek's pointer does — hide the popover. */
  onHide(): void;
  /** Called when the image moves (layout reflow, scroll) or a peek becomes full — reposition the popover. */
  onMove(rect: DOMRect, info: ImageMenuInfo): void;
}

export interface ImageMenuOptions extends ImageMenuCallbacks {
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Threaded into the focus-outside check; see createBubbleMenu for context.
   */
  getPopoverElement?: (() => HTMLElement | null) | undefined;
  /** Hover peeks. Default false; true or delays peek a hovered image. */
  hover?: HoverOption | undefined;
}

export function createImageMenu(editor: IEditor, options: ImageMenuOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let lastDocPos = -1;
  let rafId: number | null = null;
  let hovered: HoverTarget | null = null;

  function hide() {
    if (visible) { visible = false; lastDocPos = -1; onHide(); }
  }

  /** The selected image — the full presentation. */
  function selected(): { node: Node; docPos: number } | null {
    const descriptor = editor.getSelectionDescriptor();
    if (descriptor.kind !== "image") return null;
    const state = editor.surfaces.activeSurface?.state ?? editor.getState();
    const node = state.doc.nodeAt(descriptor.from);
    return node ? { node, docPos: descriptor.from } : null;
  }

  /** The hovered image, re-resolved against current state — the peek. */
  function hoveredImage(): { node: Node; docPos: number } | null {
    if (!hovered) return null;
    const doc = editor.getState().doc;
    if (hovered.pos >= doc.content.size) return null;
    const node = doc.nodeAt(hovered.pos);
    if (!node) return null;
    // An edit can replace what sits at the position without moving it.
    const kind = editor.describeSelection(NodeSelection.create(doc, hovered.pos)).kind;
    return kind === "image" ? { node, docPos: hovered.pos } : null;
  }

  function update() {
    const full = selected();
    // Selection wins: a selected image shows full and hover is ignored.
    const target = full ?? hoveredImage();
    if (!target) { hide(); return; }
    const { node, docPos } = target;

    const rect = editor.getNodeViewportRect(docPos);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      hide();
      return;
    }

    const info: ImageMenuInfo = { node, docPos, presentation: full ? "full" : "peek" };

    if (visible && lastDocPos === docPos) {
      onMove(rect, info);
    } else {
      visible = true;
      lastDocPos = docPos;
      onShow(rect, info);
    }
  }

  function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  }

  const unsubscribe = subscribeViewUpdates(editor, scheduleUpdate);
  const offHover = subscribeHoverTarget(
    editor,
    "image",
    (target) => { hovered = target; scheduleUpdate(); },
    { hover: options.hover ?? false, getPopoverElement: options.getPopoverElement },
  );
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      if (hovered && !selected()) return;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      hide();
    },
    options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {},
  );

  return () => {
    unsubscribe();
    offHover();
    offFocusOutside();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    hide();
  };
}
