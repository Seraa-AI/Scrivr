import type { Node } from "prosemirror-model";
import type { ObjectRectEntry } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import type { LayoutPage } from "./PageLayout";

/**
 * Every painted fragment of the block-level node at `docPos`, one rect per
 * page, in page order — what a popover anchors to when the node it serves
 * is not an image.
 *
 * Per page, the first of these that matches wins:
 *   1. Blocks laid out for the node itself (`sourceNodePos ?? nodePos`) — a
 *      paragraph, or each part of one split across pages.
 *   2. A table cell — the `CellSubBlock` with that `cellPos`.
 *   3. Blocks laid out for the node's descendants, unioned — a table is laid
 *      out as its rows, a list as its items.
 *
 * Each step also searches inside cells, so a table nested in another table's
 * cell has rects too.
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
    const found: Found = { own: [], cell: null, inner: null };
    collect(page.blocks, 0, page.pageNumber, docPos, end, found);
    if (found.own.length) rects.push(...found.own);
    else if (found.cell) rects.push(found.cell);
    else if (found.inner) rects.push(found.inner);
  }
  return rects;
}

interface Found {
  own: ObjectRectEntry[];
  cell: ObjectRectEntry | null;
  inner: ObjectRectEntry | null;
}

/**
 * One page's blocks, and the blocks inside each of their cells — a table
 * nested in a cell is laid out there, not on the page. A cell's blocks sit at
 * `y` relative to their row's top, so `top` carries that row's y down.
 */
function collect(
  blocks: readonly LayoutBlock[],
  top: number,
  page: number,
  docPos: number,
  end: number,
  found: Found,
): void {
  for (const block of blocks) {
    const y = top + block.y;
    if ((block.sourceNodePos ?? block.nodePos) === docPos) {
      found.own.push(rectOf(docPos, page, block.x, y, block.width, block.height));
      continue;
    }
    if (block.nodePos > docPos && block.nodePos < end) {
      const r = rectOf(docPos, page, block.x, y, block.width, block.height);
      found.inner = found.inner ? union(found.inner, r) : r;
    }
    for (const c of block.cells ?? []) {
      if (c.cellPos === docPos) {
        found.cell = rectOf(docPos, page, c.x, y + c.y, c.width, c.height);
      }
      collect(c.blocks, y, page, docPos, end, found);
    }
  }
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
