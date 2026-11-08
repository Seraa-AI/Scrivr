import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Extension } from "../Extension";
import { COLLAB_SYNC_META, NORMALIZATION_META } from "./UniqueId";

/** Where the paragraph this plugin added starts, while it is still the empty last block. */
const addedKey = new PluginKey<number | null>("trailingNode");

/**
 * TrailingNode — ensures the document always ends with a paragraph.
 *
 * Without this, if the last block is a heading, list, or code block the user
 * has no way to click below it and start typing as a paragraph.
 *
 * The paragraph it adds lasts only as long as it is needed: once the document
 * ends in a paragraph again, it is taken away, unless someone has typed in it
 * or put the caret in it. An empty last paragraph it did not add is left alone,
 * and so is one a collaborator's sync has rewritten, since sync replaces the
 * whole document and the paragraph can no longer be told apart.
 *
 * Uses appendTransaction so it runs after every transaction (including Y.js
 * remote changes) without blocking the user's own edits.
 */
export const TrailingNode = Extension.create({
  name: "trailingNode",

  addProseMirrorPlugins() {
    const { paragraph } = this.schema.nodes;
    const isAdded = (doc: EditorState["doc"], pos: number | null): pos is number => {
      const last = doc.lastChild;
      return pos !== null && last !== null && last.type === paragraph && last.content.size === 0 &&
        pos === doc.content.size - last.nodeSize;
    };

    return [
      new Plugin({
        key: addedKey,
        state: {
          init: () => null,
          apply(tr, added) {
            const own = tr.getMeta(addedKey);
            if (own !== undefined) return own;
            if (added === null) return null;
            const pos = tr.mapping.map(added);
            // Someone who puts the caret in the line makes it theirs. A caret an
            // edit moves there does not, since the edit is what made it unneeded.
            const claimed = !tr.docChanged && tr.selection.to > pos;
            return isAdded(tr.doc, pos) && !claimed ? pos : null;
          },
        },
        appendTransaction(transactions, _oldState, state) {
          const { doc } = state;
          const last = doc.lastChild;
          if (!last) return null;

          let tr: Transaction;
          if (last.type !== paragraph) {
            tr = state.tr
              .insert(doc.content.size, paragraph!.create())
              .setMeta(addedKey, doc.content.size);
          } else {
            const added = addedKey.getState(state) ?? null;
            const previous = doc.childCount > 1 ? doc.child(doc.childCount - 2) : null;
            if (!isAdded(doc, added) || previous?.type !== paragraph) return null;
            tr = state.tr.delete(added, doc.content.size).setMeta(addedKey, null);
          }
          tr.setMeta(NORMALIZATION_META, true);
          if (transactions.some((tx) => tx.docChanged && tx.getMeta(COLLAB_SYNC_META))) {
            tr.setMeta(COLLAB_SYNC_META, true);
          }
          return tr;
        },
      }),
    ];
  },
});
