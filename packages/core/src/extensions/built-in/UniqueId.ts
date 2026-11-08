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
 * Transaction meta for an edit that keeps the document well-formed rather than
 * changing what it says — nobody authored it. Track changes does not record it
 * as anyone's suggestion.
 */
export const NORMALIZATION_META = "scrivr:normalization";

/**
 * The first node, in document order (ancestors before descendants), carrying
 * this nodeId and passing `accept`.
 *
 * Use it where an id names one node: a document without track changes, or a
 * question about whether the id is anywhere in the document at all. With track
 * changes, a pending move leaves a deleted copy under the same id, and this
 * returns whichever comes first — to read or write the block a person sees, use
 * `findLiveNodeById` from `@scrivr/plugins`. `accept` is how that skips the copy
 * without core knowing about tracking.
 *
 * @example
 * findNodeById(doc, "intro");                            // any copy
 * findNodeById(doc, "intro", (node) => node.isTextblock); // the first that passes
 */
export function findNodeById(
  doc: Node,
  nodeId: string,
  accept?: (node: Node, pos: number) => boolean,
): { node: Node; pos: number } | null {
  const visit = (parent: Node, start: number): { node: Node; pos: number } | null => {
    let pos = start;
    for (let i = 0; i < parent.childCount; i++) {
      const node = parent.child(i);
      if (node.attrs["nodeId"] === nodeId && (!accept || accept(node, pos))) return { node, pos };
      const nested = visit(node, pos + 1);
      if (nested) return nested;
      pos += node.nodeSize;
    }
    return null;
  };
  return visit(doc, 0);
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
          return tr.setMeta(NORMALIZATION_META, true);
        },
      }),
    ];
  },
});
