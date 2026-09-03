import { Plugin } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Extension } from "../Extension";
import { planBlockIdAssignments } from "../../model/assignBlockIds";

/**
 * Transaction meta set by the collaboration binding when it applies a REMOTE
 * (Yjs sync) update. `UniqueId` skips stamping for these so a block's id is
 * assigned once — by its author — and synced, instead of each receiving client
 * re-stamping a divergent uuid onto the same logical node.
 */
export const COLLAB_SYNC_META = "scrivr:collabSync";

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
 * the foundation for AI suggestions, track changes, diffs, and semantic
 * chunking. Ships in StarterKit so stable ids are the default with or without
 * the AI toolkit.
 *
 * Assignment happens at edit-time and is persisted in the document, so ids are
 * stable across reloads. Read/emit surfaces (ServerEditor export) never
 * fabricate ids on load — they preserve what's persisted, which is what keeps
 * chunk identity deterministic.
 *
 * The assignment rule lives in `planBlockIdAssignments` so server-side
 * normalization and AI ingestion paths apply identical semantics without going
 * through a live editor.
 */
export const UniqueId = Extension.create({
  name: "uniqueId",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          // Only stamp for a LOCAL doc change. A remote collab apply can also
          // cause earlier plugins to append bookkeeping transactions (e.g. a
          // trailing paragraph). Those appended transactions usually do not
          // carry the original meta, so the whole append batch is treated as
          // remote if any doc-changing transaction is tagged as collab sync.
          const hasRemoteDocChange = transactions.some(
            (tr) => tr.docChanged && tr.getMeta(COLLAB_SYNC_META),
          );
          if (hasRemoteDocChange) return null;

          const hasLocalDocChange = transactions.some((tr) => tr.docChanged);
          if (!hasLocalDocChange) return null;

          const assignments = planBlockIdAssignments(newState.doc);
          if (assignments.length === 0) return null;

          const tr = newState.tr;
          for (const { pos, attrs } of assignments) {
            tr.setNodeMarkup(pos, undefined, attrs);
          }
          // setNodeMarkup is a content step, which clears storedMarks. This is
          // pure structural bookkeeping — it must not drop the marks the
          // triggering transaction left pending (e.g. bold carried across an
          // Enter split), so restore them.
          tr.setStoredMarks(newState.storedMarks);
          return tr;
        },
      }),
    ];
  },
});
