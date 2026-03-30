import { Plugin } from "prosemirror-state";
import { Extension } from "../Extension";

/**
 * TrailingNode — ensures the document always ends with an empty paragraph.
 *
 * Without this, if the last block is a heading, list, or code block the user
 * has no way to click below it and start typing as a paragraph.
 *
 * Uses appendTransaction so it runs after every transaction (including Y.js
 * remote changes) without blocking the user's own edits.
 */
export const TrailingNode = Extension.create({
  name: "trailingNode",

  addProseMirrorPlugins() {
    const { paragraph } = this.schema.nodes;
    return [
      new Plugin({
        appendTransaction(_, __, state) {
          const last = state.doc.lastChild;
          if (!last || last.type === paragraph) return null;
          return state.tr.insert(state.doc.content.size, paragraph!.create());
        },
      }),
    ];
  },
});
