import type { Node } from "prosemirror-model";

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
