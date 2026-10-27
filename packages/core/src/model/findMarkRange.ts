import type { MarkType, Node } from "prosemirror-model";

/**
 * The contiguous range covered by `markType` around `pos`, within `pos`'s
 * textblock. Shared by the link popover and the hover mark resolvers.
 */
export function findMarkRange(
  doc: Node,
  pos: number,
  markType: MarkType,
): { from: number; to: number } {
  const $pos = doc.resolve(pos);
  const start = $pos.start();
  const end = $pos.end();

  let from = pos;
  let to = pos;

  doc.nodesBetween(start, pos, (node, nodePos) => {
    if (node.isText && node.marks.some((m) => m.type === markType)) {
      from = Math.min(from, nodePos);
    }
  });

  doc.nodesBetween(pos, end, (node, nodePos) => {
    if (node.isText && node.marks.some((m) => m.type === markType)) {
      to = Math.max(to, nodePos + node.nodeSize);
    }
  });

  return { from, to };
}
