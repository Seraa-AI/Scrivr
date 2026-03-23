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
import type { Node, MarkType } from "prosemirror-model";
import type { IEditor } from "../extensions/types";

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

export type LinkPopoverOptions = LinkPopoverCallbacks;

export function createLinkPopover(editor: IEditor, options: LinkPopoverOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;

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

    // Walk outward from cursor to find the full extent of this mark
    const { from, to } = findMarkRange(state.doc, head, markInstance.type);
    const href = markInstance.attrs["href"] as string;

    const rect = editor.getViewportRect(from, to);
    if (!rect) {
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

  const unsubscribe = editor.subscribe(update);

  return () => {
    unsubscribe();
    if (visible) { visible = false; onHide(); }
  };
}

/** Walk the doc to find the contiguous range covered by a specific mark type around `pos`. */
function findMarkRange(
  doc: Node,
  pos: number,
  markType: MarkType,
): { from: number; to: number } {
  const $pos  = doc.resolve(pos);
  const start = $pos.start();
  const end   = $pos.end();

  let from = pos;
  let to   = pos;

  // Walk backwards to find start of mark
  doc.nodesBetween(start, pos, (node, nodePos) => {
    if (node.isText && node.marks.some((m) => m.type === markType)) {
      from = Math.min(from, nodePos);
    }
  });

  // Walk forwards to find end of mark
  doc.nodesBetween(pos, end, (node, nodePos) => {
    if (node.isText && node.marks.some((m) => m.type === markType)) {
      to = Math.max(to, nodePos + node.nodeSize);
    }
  });

  return { from, to };
}
