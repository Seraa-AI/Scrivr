import { Extension } from "../Extension";
import { NodeSelection } from "prosemirror-state";
import type { Command, EditorState } from "prosemirror-state";
import { splitBlockAs } from "prosemirror-commands";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import {
  xml,
  type DocxNodeHandler,
  type DocxBlockTransform,
} from "../../exports/docx";
import type { SemanticNodeHandler } from "../../exports/semantic";
import type { Node as PmNode } from "prosemirror-model";
import { normalizeImageAttrs } from "../../layout/AnchoredObjects";

/** A paragraph whose only non-whitespace content is a single image. */
function isImageOnlyParagraph(node: PmNode): boolean {
  let images = 0;
  let other = 0;
  node.forEach((child) => {
    if (child.type.name === "image") images += 1;
    else if (child.isText && (child.text ?? "").trim() === "") {
      /* surrounding whitespace is fine */
    } else other += 1;
  });
  return images === 1 && other === 0;
}

/**
 * OOXML `<w:jc>` value for a block `align` attr, or null for the default (left)
 * — so the DOCX exporter carries centered/right/justified text. Shared by the
 * Paragraph and Heading export handlers.
 */
export function alignToJc(align: unknown): string | null {
  if (align === "center") return "center";
  if (align === "right") return "right";
  if (align === "justify") return "both";
  return null;
}

/**
 * Splits the current block and carries `fontFamily` and `align` from the
 * source block onto the new block. Also preserves stored inline marks,
 * matching the behaviour of ProseMirror's built-in splitBlockKeepMarks.
 *
 * "Defining" blocks (headings) split into a paragraph rather than another
 * heading — same as the ProseMirror default — but the heading's fontFamily
 * is still carried forward.
 */
const splitParagraph = splitBlockAs((parent, _atEnd, $from) => {
  const paraType = $from.node(0).type.schema.nodes["paragraph"]!;
  // Defining blocks (headings) split into a paragraph; others keep their type.
  const newType = parent.type.spec.defining ? paraType : parent.type;
  const attrs: Record<string, unknown> = {};

  if ("fontFamily" in (newType.spec.attrs ?? {})) {
    // Priority: explicit block-level fontFamily attr (set via setBlockFontFamily)
    // → inline fontFamily mark at cursor position (set via setFontFamily or paste)
    // → null (fall back to blockStyle default)
    const blockFamily = (parent.attrs["fontFamily"] as string | null) ?? null;
    const markFamily =
      blockFamily == null
        ? (($from.marks().find((m) => m.type.name === "fontFamily")?.attrs[
            "family"
          ] as string | undefined) ?? null)
        : null;
    attrs["fontFamily"] = blockFamily ?? markFamily;
  }
  if ("align" in (newType.spec.attrs ?? {}))
    attrs["align"] = parent.attrs["align"] ?? "left";
  if ("indent" in (newType.spec.attrs ?? {}))
    attrs["indent"] = parent.attrs["indent"] ?? 0;
  if ("textIndent" in (newType.spec.attrs ?? {}))
    attrs["textIndent"] = parent.attrs["textIndent"] ?? 0;

  return { type: newType, attrs };
});

/**
 * Is the selection a whole anchored object — an image that floats out of the
 * text flow rather than sitting in it?
 *
 * An inline image is content: selecting it and pressing Enter replaces it with
 * a break, the same as selected text. An anchored one is not in the flow at
 * all; its position in the document is an anchor, not a place in the sentence.
 * Splitting there inserts a paragraph break the reader never asked for, in a
 * spot they cannot see.
 */
function isAnchoredObjectSelected(state: EditorState): boolean {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return false;
  if (selection.node.type.name !== "image") return false;
  return normalizeImageAttrs(selection.node).wrapMode !== "inline";
}

export const splitBlockInheritAttrs: Command = (state, dispatch) => {
  // Enter with a float selected does nothing. The alternative is splitting at
  // the anchor: the visible text stays whole, so the keypress reads as ignored
  // while an empty paragraph accumulates each time — press Enter a few times
  // and a hole opens in the page with no undo affordance pointing at it.
  if (isAnchoredObjectSelected(state)) return true;

  return splitParagraph(
    state,
    dispatch &&
      ((tr) => {
        // Preserve stored inline marks, same as splitBlockKeepMarks.
        const marks =
          state.storedMarks ??
          (state.selection.$from.parentOffset
            ? state.selection.$from.marks()
            : null);
        if (marks) tr.ensureMarks(marks);
        dispatch(tr);
      }),
  );
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
          align: { default: "left" },
          indent: { default: 0 },
          textIndent: { default: 0 },
          fontFamily: { default: null },
          nodeId: { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [
          {
            tag: "p",
            getAttrs(dom) {
              const el = dom as HTMLElement;
              const rawFamily = el.style.fontFamily;
              const fontFamily = rawFamily
                ? (rawFamily.replace(/['"]/g, "").split(",")[0] ?? "").trim() ||
                  null
                : null;
              const rawMarginLeft = parseFloat(el.style.marginLeft) || 0;
              const rawTextIndent = parseFloat(el.style.textIndent) || 0;
              return {
                align: el.style.textAlign || "left",
                indent: rawMarginLeft > 0 ? Math.round(rawMarginLeft / 24) : 0,
                textIndent: rawTextIndent > 0 ? rawTextIndent : 0,
                fontFamily: fontFamily,
                nodeId: el.getAttribute("data-node-id") ?? null,
              };
            },
          },
        ],
        toDOM: (node) => {
          let style = `text-align:${node.attrs.align as string}`;
          if (node.attrs.indent)
            style += `;margin-left:${(node.attrs.indent as number) * 24}px`;
          if (node.attrs.textIndent)
            style += `;text-indent:${node.attrs.textIndent as number}px`;
          if (node.attrs.fontFamily)
            style += `;font-family:${node.attrs.fontFamily as string}`;
          const attrs: Record<string, string> = { style };
          if (node.attrs.nodeId)
            attrs["data-node-id"] = node.attrs.nodeId as string;
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
      paragraph: {
        font: "14px",
        spaceBefore: 0,
        spaceAfter: 10,
        align: "left" as const,
      },
    };
  },

  addExports() {
    const handler: DocxNodeHandler = (node, children) => {
      const jc = alignToJc(node.attrs["align"]);
      const lead = jc ? [xml("w:pPr", undefined, [xml("w:jc", { "w:val": jc })])] : [];
      return xml("w:p", undefined, [...lead, ...children]);
    };
    const semanticHandler: SemanticNodeHandler = (node) =>
      isImageOnlyParagraph(node) ? { type: "image" } : { type: "paragraph" };
    return {
      docx: { nodes: { paragraph: handler } },
      semantic: { nodes: { paragraph: semanticHandler } },
    };
  },

  addImports() {
    // Paragraph claims `DocxBlock.type === "paragraph"`. Heading / CodeBlock
    // / other paragraphStyle overrides fire first, so this only handles
    // plain paragraphs.
    const importer: DocxBlockTransform = (block, content, ctx) => {
      if (block.type !== "paragraph") return null;
      const t = ctx.schema.nodes["paragraph"];
      if (!t) return null;
      const attrs: Record<string, unknown> = {};
      if (block.attrs.align && block.attrs.align !== "left") {
        attrs.align = block.attrs.align;
      }
      return t.create(Object.keys(attrs).length > 0 ? attrs : null, content);
    };
    return { docx: { blocks: { paragraph: importer } } };
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

declare module "@scrivr/core" {
  interface NodeAttributes {
    paragraph: {
      /** Text alignment override. */
      align?: "left" | "center" | "right" | "justify";
      /** Font family override. */
      fontFamily?: string | null;
    };
  }
}
