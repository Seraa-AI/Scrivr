import { Extension } from "../Extension";
import { splitBlockKeepMarks } from "prosemirror-commands";
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
          fontFamily:  { default: null },
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [{
          tag: "p",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            const rawFamily = el.style.fontFamily;
            const fontFamily = rawFamily
              ? (rawFamily.replace(/['"]/g, "").split(",")[0] ?? "").trim() || null
              : null;
            return {
              align:      el.style.textAlign || "left",
              fontFamily: fontFamily,
              nodeId:     el.getAttribute("data-node-id") ?? null,
            };
          },
        }],
        toDOM: (node) => {
          let style = `text-align:${node.attrs.align as string}`;
          if (node.attrs.fontFamily) style += `;font-family:${node.attrs.fontFamily as string}`;
          const attrs: Record<string, string> = { style };
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return ["p", attrs, 0];
        },
      },
    };
  },

  addKeymap() {
    return {
      Enter: splitBlockKeepMarks,
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
