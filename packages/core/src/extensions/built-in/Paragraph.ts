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
          align:       { default: "left" },
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [{
          tag: "p",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              align:  el.style.textAlign || "left",
              nodeId: el.getAttribute("data-node-id") ?? null,
            };
          },
        }],
        toDOM: (node) => {
          const attrs: Record<string, string> = { style: `text-align:${node.attrs.align}` };
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return ["p", attrs, 0];
        },
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
