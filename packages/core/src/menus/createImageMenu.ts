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

export interface ImageMenuInfo {
  /** The selected image ProseMirror node (access attrs via info.node.attrs). */
  node: Node;
  /** Doc position of the image node — use with editor.selectNode() or transactions. */
  docPos: number;
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
}

export function createImageMenu(editor: IEditor, options: ImageMenuOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let lastDocPos = -1;
  let rafId: number | null = null;

  function update() {
    const actions = editor.getNodeActions();
    const descriptor = editor.getSelectionDescriptor();
    const state = editor.surfaces.activeSurface?.state ?? editor.getState();
    const docPos = descriptor.from;
    const node = state.doc.nodeAt(docPos);

    // If there are no actions for this node, or the node doesn't exist, hide the menu.
    if (actions.length === 0 || !node) {
      if (visible) { visible = false; lastDocPos = -1; onHide(); }
      return;
    }

    const rect = editor.getNodeViewportRect(docPos);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      if (visible) { visible = false; lastDocPos = -1; onHide(); }
      return;
    }

    const info: ImageMenuInfo = { node, docPos };

    if (visible && lastDocPos === docPos) {
      onMove(rect, info);
    } else {
      visible = true;
      lastDocPos = docPos;
      onShow(rect, info);
    }
  }

  const unsubscribe = subscribeViewUpdates(editor, () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  });
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (visible) { visible = false; lastDocPos = -1; onHide(); }
    },
    options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {},
  );

  return () => {
    unsubscribe();
    offFocusOutside();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (visible) { visible = false; lastDocPos = -1; onHide(); }
  };
}
