import { Plugin } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Extension } from "../Extension";

/**
 * Check if a paragraph is a valid cursor target. An empty paragraph is valid
 * (the layout engine adds a zero-width space for cursor placement). A paragraph
 * containing only float anchors (images with wrappingMode != "inline") is NOT
 * valid — the user sees an empty line with no cursor target because the float
 * anchor is zero-width and the image renders independently.
 */
function isValidCursorTarget(node: Node): boolean {
  // Empty paragraph — valid (layout adds \u200B cursor placeholder)
  if (node.childCount === 0) return true;

  let hasOnlyFloatAnchors = true;
  node.forEach((child) => {
    if (!hasOnlyFloatAnchors) return;
    if (child.isText) { hasOnlyFloatAnchors = false; return; }
    if (child.isLeaf && !child.isText) {
      const wm = child.attrs["wrappingMode"];
      // Inline images and other non-float atoms are valid content
      if (!wm || wm === "inline") hasOnlyFloatAnchors = false;
    }
  });

  // If the paragraph has ONLY float anchors, it's not a valid cursor target
  return !hasOnlyFloatAnchors;
}

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
          // No trailing node needed if the doc already ends with a paragraph
          // that has renderable text content. A paragraph containing only a
          // float anchor (zero-width image placeholder) is NOT renderable —
          // the user has no visible cursor target, so we append a fresh one.
          if (!last) return null;
          if (last.type === paragraph && isValidCursorTarget(last)) return null;
          return state.tr.insert(state.doc.content.size, paragraph!.create());
        },
      }),
    ];
  },
});
