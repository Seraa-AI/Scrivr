import { Plugin } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Extension } from "@inscribe/core";

// ── ID generator ──────────────────────────────────────────────────────────────

function generateNodeId(): string {
  return `node-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Find a block node in the document by its stable nodeId attribute.
 * Returns the node and its absolute ProseMirror position, or null if not found.
 */
export function findNodeById(
  doc: Node,
  nodeId: string,
): { node: Node; pos: number } | null {
  let result: { node: Node; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.attrs["nodeId"] === nodeId) {
      result = { node, pos };
      return false; // stop traversal
    }
  });
  return result;
}

// ── Extension ─────────────────────────────────────────────────────────────────

/**
 * UniqueId — stamps every new block node with a stable `nodeId` attribute.
 *
 * Uses appendTransaction to detect newly created nodes (nodeId === null) and
 * assign them a unique ID. This gives every block a durable structural anchor
 * that survives position shifts from concurrent insertions and deletions —
 * the foundation for AI suggestions, track changes, and diffs.
 *
 * Requires that block node specs declare `nodeId: { default: null }` in their
 * attrs. Paragraph, Heading, ListItem, CodeBlock, and Image all include this.
 */
export const UniqueId = Extension.create({
  name: "uniqueId",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          // Skip if no document change occurred
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            // Only stamp block nodes that declare nodeId but haven't been assigned one
            if (
              node.isBlock &&
              "nodeId" in (node.type.spec.attrs ?? {}) &&
              node.attrs["nodeId"] === null
            ) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                nodeId: generateNodeId(),
              });
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
