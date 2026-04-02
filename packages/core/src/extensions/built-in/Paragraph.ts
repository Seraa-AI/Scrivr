import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import { splitBlockAs } from "prosemirror-commands";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";

/**
 * Splits the current block and carries `fontFamily` and `align` from the
 * source block onto the new block. Also preserves stored inline marks,
 * matching the behaviour of ProseMirror's built-in splitBlockKeepMarks.
 *
 * "Defining" blocks (headings) split into a paragraph rather than another
 * heading — same as the ProseMirror default — but the heading's fontFamily
 * is still carried forward.
 */
const _split = splitBlockAs((parent, _atEnd, $from) => {
  const paraType = $from.node(0).type.schema.nodes["paragraph"]!;
  // Defining blocks (headings) split into a paragraph; others keep their type.
  const newType = parent.type.spec.defining ? paraType : parent.type;
  const attrs: Record<string, unknown> = {};

  if ("fontFamily" in (newType.spec.attrs ?? {})) {
    // Priority: explicit block-level fontFamily attr (set via setBlockFontFamily)
    // → inline font_family mark at cursor position (set via setFontFamily or paste)
    // → null (fall back to blockStyle default)
    const blockFamily = parent.attrs["fontFamily"] as string | null ?? null;
    const markFamily = blockFamily == null
      ? ($from.marks().find((m) => m.type.name === "font_family")?.attrs["family"] as string | undefined ?? null)
      : null;
    attrs["fontFamily"] = blockFamily ?? markFamily;
  }
  if ("align" in (newType.spec.attrs ?? {})) attrs["align"] = parent.attrs["align"] ?? "left";

  return { type: newType, attrs };
});

export const splitBlockInheritAttrs: Command = (state, dispatch) => {
  return _split(state, dispatch && ((tr) => {
    // Preserve stored inline marks, same as splitBlockKeepMarks.
    const marks = state.storedMarks ?? (state.selection.$from.parentOffset ? state.selection.$from.marks() : null);
    if (marks) tr.ensureMarks(marks);
    dispatch(tr);
  }));
};

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
      Enter: splitBlockInheritAttrs,
    };
  },

  addLayoutHandlers() {
    return { paragraph: TextBlockStrategy };
  },

  addBlockStyles() {
    return {
      paragraph: { font: "14px", spaceBefore: 0, spaceAfter: 10, align: "left" as const },
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
