/**
 * createImageMenu — framework-agnostic controller for an image toolbar popover.
 *
 * Shows when the active selection's descriptor kind is "image" (the kind the
 * Image extension's SelectionBehavior reports).
 * Passes the image node, its doc position, and a viewport DOMRect to the
 * callbacks so the consumer can render resize / wrapping / margin controls.
 *
 * The DOMRect covers the full visual bounds of the image (not cursor-sized),
 * so `rect.bottom` is a reliable anchor for a popover below the image.
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
import type { IEditor } from "../extensions/types";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";
import type { HoverTarget } from "../hover/types";
import {
  resolveHoverOption,
  subscribeHoverTarget,
  type HoverOption,
  type PopoverPresentation,
} from "./subscribeHoverTarget";

export interface ImageMenuInfo {
  /** The selected image ProseMirror node (access attrs via info.node.attrs). */
  node: Node;
  /** Doc position of the image node — use with editor.selectNode() or transactions. */
  docPos: number;
  /** "peek" when shown from hover, "full" when the image is selected. */
  presentation: PopoverPresentation;
}

export interface ImageMenuCallbacks {
  /** Called when an image is first selected. Position the popover using rect. */
  onShow(rect: DOMRect, info: ImageMenuInfo): void;
  /** Called when the selection leaves the image — hide the popover. */
  onHide(): void;
  /** Called when the image moves (layout reflow, scroll) — reposition the popover. */
  onMove(rect: DOMRect, info: ImageMenuInfo): void;
}

export interface ImageMenuOptions extends ImageMenuCallbacks {
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Threaded into the focus-outside check; see createBubbleMenu for context.
   */
  getPopoverElement?: () => HTMLElement | null;
  /** Hover peeks. Default true; false shows the menu from the selection only. */
  hover?: HoverOption;
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

  /** The selected node with actions — the full presentation. */
  function selected(): { node: Node; docPos: number } | null {
    const actions = editor.getNodeActions();
    if (actions.length === 0) return null;
    const descriptor = editor.getSelectionDescriptor();
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
    return node ? { node, docPos: hovered.pos } : null;
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
  const hoverDelays = resolveHoverOption(options.hover);
  const offHover = hoverDelays
    ? subscribeHoverTarget(
        editor,
        "image",
        (target) => { hovered = target; scheduleUpdate(); },
        { ...hoverDelays, ...(options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {}) },
      )
    : () => {};
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
