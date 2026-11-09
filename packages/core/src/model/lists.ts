import type { ContentMatch, Node, NodeType } from "prosemirror-model";

export type ListKind = "bullet" | "ordered";

/**
 * A list container: a node whose content allows list items and nothing else.
 * Every child its content expression can take, at any point, is a `listItem`.
 */
export function isListType(type: NodeType): boolean {
  const listItem = type.schema.nodes["listItem"];
  if (!listItem) return false;
  const seen = new Set<ContentMatch>([type.contentMatch]);
  const pending = [type.contentMatch];
  let allowsItem = false;
  for (let match = pending.pop(); match; match = pending.pop()) {
    for (let i = 0; i < match.edgeCount; i++) {
      const { type: child, next } = match.edge(i);
      if (child !== listItem) return false;
      allowsItem = true;
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return allowsItem;
}

/**
 * Bullet or ordered, for a list container; null for anything else. Only an
 * `orderedList` numbers its items; any other list is drawn with bullets.
 */
export function listKind(node: Node): ListKind | null {
  if (!isListType(node.type)) return null;
  return node.type.name === "orderedList" ? "ordered" : "bullet";
}
