import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import { splitBlockAs } from "prosemirror-commands";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import {
  serializeParagraphBorders,
  parseParagraphBordersAttr,
  serializeParagraphShading,
  parseParagraphShadingAttr,
} from "../../model/paragraphBorders";
import type {
  ParagraphBorders,
  ParagraphShading,
} from "../../model/paragraphBorders";
import {
  xml,
  type DocxNodeHandler,
  type DocxBlockTransform,
} from "../../exports/docx";
import type { SemanticNodeHandler } from "../../exports/semantic";
import type { Node as PmNode } from "prosemirror-model";

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
  // Borders/shading carry to the split paragraph so Enter inside a bordered
  // paragraph keeps the box (and, once grouping lands, forms one group).
  if ("borders" in (newType.spec.attrs ?? {}))
    attrs["borders"] = parent.attrs["borders"] ?? null;
  if ("shading" in (newType.spec.attrs ?? {}))
    attrs["shading"] = parent.attrs["shading"] ?? null;

  return { type: newType, attrs };
});

export const splitBlockInheritAttrs: Command = (state, dispatch) => {
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
          borders: { default: null },
          shading: { default: null },
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
                borders: parseParagraphBordersAttr(
                  el.getAttribute("data-paragraph-borders"),
                ),
                shading: parseParagraphShadingAttr(
                  el.getAttribute("data-paragraph-shading"),
                ),
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
          const borders = serializeParagraphBorders(node.attrs.borders);
          if (borders) attrs["data-paragraph-borders"] = borders;
          const shading = serializeParagraphShading(node.attrs.shading);
          if (shading) attrs["data-paragraph-shading"] = shading;
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
      /** Paragraph border formatting (OOXML `w:pBdr`). */
      borders?: ParagraphBorders | null;
      /** Paragraph shading fill (OOXML `w:shd`). */
      shading?: ParagraphShading | null;
    };
  }
}
