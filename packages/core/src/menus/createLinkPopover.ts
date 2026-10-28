/**
 * createLinkPopover — framework-agnostic controller for a link editing popover.
 *
 * Automatically shows when the cursor (or selection) overlaps a `link` mark.
 * Passes the link's href and the mark's doc range to the callbacks so the
 * consumer can render an "Open / Edit / Remove" popover.
 *
 * @example — vanilla JS
 *   const cleanup = createLinkPopover(editor, {
 *     onShow: (rect, href, range) => {
 *       popover.style.cssText = `display:block;left:${rect.left}px;top:${rect.bottom + 8}px`;
 *       popover.querySelector("a").href = href;
 *     },
 *     onHide: () => { popover.style.display = "none" },
 *   });
 */
import type { Mark, Node } from "prosemirror-model";
import type { IEditor } from "../extensions/types";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";

export interface LinkPopoverInfo {
  /** The href attribute of the link mark under the cursor. */
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
    const $pos     = state.doc.resolve(head);

    // Find a link mark at the cursor position
    const linkMark = state.schema.marks["link"];
    if (!linkMark) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    const markInstance = $pos.marks().find((m) => m.type === linkMark)
      ?? state.doc.resolve(Math.max(0, head - 1)).marks().find((m) => m.type === linkMark);

    if (!markInstance) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    const { from, to } = findMarkRange(state.doc, head, markInstance);
    const href = markInstance.attrs["href"] as string;

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

/**
 * The run of adjacent text in `pos`'s textblock that carries this exact `mark`.
 * Matching the instance, not the type, keeps two neighbouring links apart.
 */
function findMarkRange(doc: Node, pos: number, mark: Mark): { from: number; to: number } {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const carriesMark = (index: number) =>
    index >= 0 && index < parent.childCount && mark.isInSet(parent.child(index).marks);

  let index = $pos.index();
  // A caret just past the link's last character resolves to the node after it.
  if (!carriesMark(index)) index -= 1;
  if (!carriesMark(index)) return { from: pos, to: pos };

  let first = index;
  let last = index;
  while (carriesMark(first - 1)) first--;
  while (carriesMark(last + 1)) last++;

  let from = $pos.start();
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
  return { from, to };
}
