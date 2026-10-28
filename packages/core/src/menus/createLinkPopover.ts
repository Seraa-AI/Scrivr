/**
 * createLinkPopover — framework-agnostic controller for a link editing popover.
 *
 * Shows while the caret (the selection's head) is in a link. Passes the link's
 * href and doc range to the callbacks so the consumer can render an
 * "Open / Edit / Remove" popover.
 *
 * @example — vanilla JS
 *   const place = (rect, { href }) => {
 *     popover.style.cssText = `display:block;left:${rect.left}px;top:${rect.bottom + 8}px`;
 *     popover.querySelector("a").href = href;
 *   };
 *   const cleanup = createLinkPopover(editor, {
 *     onShow: place,
 *     onMove: place,
 *     onHide: () => { popover.style.display = "none" },
 *   });
 */
import type { IEditor } from "../extensions/types";
import { linkAt } from "../extensions/built-in/Link";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";

export interface LinkPopoverInfo {
  /** The href of the link the caret is in. */
  href: string;
  /** Doc position where the link mark starts. */
  from: number;
  /** Doc position where the link mark ends. */
  to: number;
}

export interface LinkPopoverCallbacks {
  onShow: (rect: DOMRect, info: LinkPopoverInfo) => void;
  onHide: () => void;
  onMove: (rect: DOMRect, info: LinkPopoverInfo) => void;
}

export interface LinkPopoverOptions extends LinkPopoverCallbacks {
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Threaded into the focus-outside check; see createBubbleMenu for context.
   */
  getPopoverElement?: () => HTMLElement | null;
}

export function createLinkPopover(editor: IEditor, options: LinkPopoverOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let rafId: number | null = null;

  function update() {
    const state    = editor.getState();
    const { head } = state.selection;
    const linkType = state.schema.marks["link"];
    const link = linkType ? linkAt(state.doc, head, linkType) : null;
    if (!link) {
      if (visible) { visible = false; onHide(); }
      return;
    }
    const { href, from, to } = link;

    const rect = editor.getViewportRect(from, to);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    const info: LinkPopoverInfo = { href, from, to };

    if (visible) {
      onMove(rect, info);
    } else {
      visible = true;
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
      if (visible) { visible = false; onHide(); }
    },
    options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {},
  );

  return () => {
    unsubscribe();
    offFocusOutside();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (visible) { visible = false; onHide(); }
  };
}
