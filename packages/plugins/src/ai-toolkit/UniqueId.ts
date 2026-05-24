import { Plugin } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Extension, planBlockIdAssignments } from "@scrivr/core";

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

/**
 * UniqueId — stamps every new block node with a stable `nodeId` attribute.
 *
 * Uses appendTransaction to detect newly created nodes (nodeId === null) and
 * assign them a unique ID. This gives every block a durable structural anchor
 * that survives position shifts from concurrent insertions and deletions —
 * the foundation for AI suggestions, track changes, and diffs.
 *
 * The assignment rule lives in `@scrivr/core`'s `planBlockIdAssignments` so
 * server-side normalization and AI ingestion paths apply identical semantics
 * without going through a live editor.
 */
export const UniqueId = Extension.create({
  name: "uniqueId",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          // Skip if no document change occurred
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const assignments = planBlockIdAssignments(newState.doc);
          if (assignments.length === 0) return null;

          const tr = newState.tr;
          for (const { pos, attrs } of assignments) {
            tr.setNodeMarkup(pos, undefined, attrs);
          }
          return tr;
        },
      }),
    ];
  },
});
