import type { Node } from "prosemirror-model";
import { breakOf } from "../layout/BlockRegistry";

/**
 * A block's level in the document outline, 1 at the top, as its spec's
 * `outlineLevel` declares it; null for a block that heads no section. The PDF
 * bookmarks and the semantic outline both read it. Each still decides which
 * blocks it visits: the bookmarks include headings in table cells and leave
 * out empty titles, the semantic outline reads only the document's own blocks.
 */
export function outlineLevelOf(node: Node): number | null {
  const declared: unknown = node.type.spec["outlineLevel"];
  if (typeof declared !== "function") return null;
  const level: unknown = declared(node);
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}

/**
 * A block's title in the document outline: its text as the proposed view
 * reads it (what `isRemoved` leaves out is not there), a line break as a
 * space, runs of whitespace as one, trimmed. An empty title heads nothing.
 * The PDF bookmarks and the semantic outline both title a heading with it.
 */
export function outlineTitleOf(node: Node, isRemoved: (node: Node) => boolean): string {
  let text = "";
  node.descendants((child) => {
    if (isRemoved(child)) return false;
    if (child.isText) text += child.text ?? "";
    else if (breakOf(child.type) === "line") text += " ";
    return true;
  });
  return text.replace(/\s+/g, " ").trim();
}
