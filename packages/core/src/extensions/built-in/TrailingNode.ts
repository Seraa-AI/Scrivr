import { isHistoryTransaction } from "prosemirror-history";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Extension } from "../Extension";
import { COLLAB_SYNC_META, NORMALIZATION_META } from "./UniqueId";

interface TrailingState {
  /** Where the paragraph this plugin added starts, while it is still the empty last block. */
  added: number | null;
  /** Ids of paragraphs it added that went before anyone claimed them, until they are back in the document. */
  gone: ReadonlySet<string>;
}

const addedKey = new PluginKey<TrailingState>("trailingNode");

/**
 * TrailingNode — ensures the document always ends with a paragraph.
 *
 * Without this, if the last block is a heading, list, or code block the user
 * has no way to click below it and start typing as a paragraph.
 *
 * The paragraph it adds lasts only as long as it is needed: once the block
 * above it is a paragraph, an edit takes it away, unless someone has typed in it
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
      doc.descendants(node => {
        missing.delete(node.attrs["nodeId"]);
        return !node.isTextblock;
      });
      return missing;
    };

    /** What another plugin appends to an undo or redo counts as part of it. */
    const isEditOutsideHistory = (tr: Transaction): boolean => {
      const root: Transaction | undefined = tr.getMeta("appendedTransaction");
      return tr.docChanged && !isHistoryTransaction(root ?? tr);
    };

    const onlyDeletes = (tr: Transaction): boolean => {
      let deleted = 0;
      let inserted = 0;
      tr.mapping.maps.forEach(map => map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        deleted += oldEnd - oldStart;
        inserted += newEnd - newStart;
      }));
      return deleted > 0 && inserted === 0;
    };

    return [
      new Plugin<TrailingState>({
        key: addedKey,
        state: {
          init: () => ({ added: null, gone: new Set() }),
          apply(tr, { added, gone }, oldState) {
            if (!tr.docChanged) {
              // Someone who puts the caret in the line makes it theirs. A selection
              // that only runs into it, like Select All, does not.
              const claimed = added !== null && tr.selection.from >= added;
              return { added: claimed ? null : added, gone };
            }

            const own: number | null | undefined = tr.getMeta(addedKey);
            const addedId = idAt(tr.before, added);
            const ours = addedId === null ? gone : new Set(gone).add(addedId);
            const stillGone = missingFrom(tr.doc, ours);
            if (own !== undefined) return { added: own, gone: stillGone };

            // Positions cannot say whose line an undo brought back, so its id
            // does. A line without one keeps being followed by position.
            const followedByPosition = added !== null && addedId === null;
            let pos = added === null ? null : tr.mapping.map(added);
            if (isHistoryTransaction(tr) && !followedByPosition) {
              const lastPos = tr.doc.content.size - (tr.doc.lastChild?.nodeSize ?? 0);
              const lastId = idAt(tr.doc, lastPos);
              pos = lastId !== null && ours.has(lastId) ? lastPos : null;
            } else if (added !== null && pos !== null) {
              // An edit that moves the caret into the line does not claim it, since
              // the edit is what made it unneeded. A deletion that leaves the caret
              // there does, when the selection already reached into it: the line is
              // what is left of what was selected.
              const leftInIt = oldState.selection.to > added && tr.selection.from >= pos && onlyDeletes(tr);
              if (leftInIt) pos = null;
            }
            return { added: isEmptyLastParagraph(tr.doc, pos) ? pos : null, gone: stillGone };
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
            // History does not map its older steps through what is appended to an
            // undo or redo, so deleting here can make the next undo or redo throw.
            if (!transactions.some(isEditOutsideHistory)) return null;
            const added = addedKey.getState(state)?.added ?? null;
            const previous = doc.childCount > 1 ? doc.child(doc.childCount - 2) : null;
            if (!isEmptyLastParagraph(doc, added) || previous?.type !== paragraph) return null;
            tr = state.tr.delete(added, doc.content.size).setMeta(addedKey, null);
            // Mapped, a selection that ends in the line would collapse to a caret.
            const { selection } = state;
            if (selection instanceof TextSelection && selection.to > added) {
              const endAbove = added - 1;
              const { anchor, head } = selection;
              tr.setSelection(TextSelection.create(tr.doc, Math.min(anchor, endAbove), Math.min(head, endAbove)));
            }
          }
          // A step clears the marks waiting for the next typing.
          tr.setStoredMarks(state.storedMarks);
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
