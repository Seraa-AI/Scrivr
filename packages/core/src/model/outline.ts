import type { Node } from "prosemirror-model";

/**
 * A block's level in the document outline, 1 at the top, as its spec's
 * `outlineLevel` declares it; null for a block that heads no section. The PDF
 * bookmarks and the semantic outline both read it, so they agree.
 */
export function outlineLevelOf(node: Node): number | null {
  const declared: unknown = node.type.spec["outlineLevel"];
  if (typeof declared !== "function") return null;
  const level: unknown = declared(node);
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}
