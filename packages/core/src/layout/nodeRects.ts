import type { Node } from "prosemirror-model";
import type { ObjectRectEntry } from "./CharacterMap";
import type { LayoutPage } from "./PageLayout";

/**
 * Every painted fragment of the block-level node at `docPos`, one rect per
 * page, in page order. See docs/hover-popovers-rfc.md §4.
 *
 * Per page, the first of these that matches wins:
 *   1. Blocks laid out for the node itself (`sourceNodePos ?? nodePos`) — a
 *      paragraph, or each part of one split across pages.
 *   2. A table cell — the `CellSubBlock` with that `cellPos`.
 *   3. Blocks laid out for the node's descendants, unioned — a table is laid
 *      out as its rows, a list as its items.
 *
 * Image-like nodes are not here; their rects come from anchored placements and
 * the character map.
 */
export function nodeFragmentRects(
  pages: readonly LayoutPage[],
  doc: Node,
  docPos: number,
): ObjectRectEntry[] {
  const node = docPos >= 0 && docPos < doc.content.size ? doc.nodeAt(docPos) : null;
  if (!node) return [];
  const end = docPos + node.nodeSize;
  const rects: ObjectRectEntry[] = [];

  for (const page of pages) {
    const own: ObjectRectEntry[] = [];
    let cell: ObjectRectEntry | null = null;
    let inner: ObjectRectEntry | null = null;

    for (const block of page.blocks) {
      if ((block.sourceNodePos ?? block.nodePos) === docPos) {
        own.push(rectOf(docPos, page.pageNumber, block.x, block.y, block.width, block.height));
        continue;
      }
      if (block.nodePos > docPos && block.nodePos < end) {
        const r = rectOf(docPos, page.pageNumber, block.x, block.y, block.width, block.height);
        inner = inner ? union(inner, r) : r;
      }
      for (const c of block.cells ?? []) {
        if (c.cellPos === docPos) {
          cell = rectOf(docPos, page.pageNumber, c.x, block.y + c.y, c.width, c.height);
        }
      }
    }

    if (own.length) rects.push(...own);
    else if (cell) rects.push(cell);
    else if (inner) rects.push(inner);
  }
  return rects;
}

function rectOf(
  docPos: number,
  page: number,
  x: number,
  y: number,
  width: number,
  height: number,
): ObjectRectEntry {
  return { docPos, page, x, y, width, height };
}

function union(a: ObjectRectEntry, b: ObjectRectEntry): ObjectRectEntry {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    docPos: a.docPos,
    page: a.page,
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
