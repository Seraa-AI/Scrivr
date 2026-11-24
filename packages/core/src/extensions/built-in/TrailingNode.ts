import { isHistoryTransaction } from "prosemirror-history";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Extension } from "../Extension";
import { COLLAB_SYNC_META, NORMALIZATION_META } from "./UniqueId";

interface TrailingState {
  /** Where the paragraph this plugin added starts, while it is still the empty last block. */
  added: number | null;
  /** Ids of paragraphs it added that are gone again, which an undo or redo can bring back. */
  gone: ReadonlySet<string>;
}

const addedKey = new PluginKey<TrailingState>("trailingNode");

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
 * whole document and the paragraph can no longer be told apart. An undo or
 * redo that brings back a paragraph it added is recognised by the paragraph's
 * id, so without UniqueId that paragraph is left alone too.
 *
 * Uses appendTransaction so it runs after every transaction (including Y.js
 * remote changes) without blocking the user's own edits.
 */
export const TrailingNode = Extension.create({
  name: "trailingNode",

  addProseMirrorPlugins() {
    const { paragraph } = this.schema.nodes;
    const isEmptyLastParagraph = (doc: EditorState["doc"], pos: number | null): pos is number => {
      const last = doc.lastChild;
      return pos !== null && last !== null && last.type === paragraph && last.content.size === 0 &&
        pos === doc.content.size - last.nodeSize;
    };

    const idAt = (doc: EditorState["doc"], pos: number | null): string | null => {
      const id: unknown = pos === null ? null : doc.nodeAt(pos)?.attrs["nodeId"];
      return typeof id === "string" ? id : null;
    };

    const missingFrom = (doc: EditorState["doc"], ids: ReadonlySet<string>): ReadonlySet<string> => {
      if (ids.size === 0) return ids;
      const missing = new Set(ids);
      doc.descendants(node => { missing.delete(node.attrs["nodeId"]); });
      return missing;
    };

    return [
      new Plugin<TrailingState>({
        key: addedKey,
        state: {
          init: () => ({ added: null, gone: new Set() }),
          apply(tr, { added, gone }) {
            const id = idAt(tr.before, added);
            const ours = id === null ? gone : new Set(gone).add(id);
            const own = tr.getMeta(addedKey);
            if (own !== undefined) return { added: own, gone: missingFrom(tr.doc, ours) };
            if (!tr.docChanged) {
              // Someone who puts the caret in the line makes it theirs. A caret an
              // edit moves there does not, since the edit is what made it unneeded.
              // Nor does a selection that only runs into it, like Select All.
              const claimed = added !== null && tr.selection.from >= added;
              return { added: claimed ? null : added, gone };
            }

            // Positions cannot say whose line an undo brought back, so its id
            // does. A line without one keeps being followed by position.
            if (isHistoryTransaction(tr) && (added === null || id !== null)) {
              const last = tr.doc.content.size - (tr.doc.lastChild?.nodeSize ?? 0);
              const lastId = idAt(tr.doc, last);
              const isOurs = lastId !== null && ours.has(lastId) && isEmptyLastParagraph(tr.doc, last);
              return { added: isOurs ? last : null, gone: missingFrom(tr.doc, ours) };
            }

            const pos = added === null ? null : tr.mapping.map(added);
            return { added: isEmptyLastParagraph(tr.doc, pos) ? pos : null, gone: missingFrom(tr.doc, gone) };
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
            const added = addedKey.getState(state)?.added ?? null;
            const previous = doc.childCount > 1 ? doc.child(doc.childCount - 2) : null;
            if (!isEmptyLastParagraph(doc, added) || previous?.type !== paragraph) return null;
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
