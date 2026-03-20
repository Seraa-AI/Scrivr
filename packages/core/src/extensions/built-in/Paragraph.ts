import { Extension } from "../Extension";
import { splitBlock } from "prosemirror-commands";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";

/**
 * Paragraph — the default block node.
 *
 * Attributes:
 *   align — "left" | "center" | "right" | "justify"
 */
export const Paragraph = Extension.create({
  name: "paragraph",

  addNodes() {
    return {
      paragraph: {
        group: "block",
        content: "inline*",
        attrs: {
          align: { default: "left" },
        },
        parseDOM: [{ tag: "p" }],
        toDOM: (node) => ["p", { style: `text-align:${node.attrs.align}` }, 0],
      },
    };
  },

  addKeymap() {
    return {
      Enter: splitBlock,
    };
  },

  addLayoutHandlers() {
    return { paragraph: TextBlockStrategy };
  },

  addBlockStyles() {
    return {
      paragraph: { font: "14px Georgia, serif", spaceBefore: 0, spaceAfter: 10, align: "left" as const },
    };
  },

  addMarkdownParserTokens() {
    return {
      paragraph: { block: "paragraph" },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        paragraph(state, node) {
          state.renderInline(node);
          state.closeBlock(node);
        },
      },
    };
  },
});
