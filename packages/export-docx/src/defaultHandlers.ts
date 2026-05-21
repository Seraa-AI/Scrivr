/**
 * Default DOCX handlers for the StarterKit semantic primitives.
 *
 * These are merged in as the lowest-priority layer of the handler stack —
 * extension contributions override them, and `options.overrides` overrides
 * those in turn. Without these, an unconfigured editor exports an empty
 * body that Word rejects.
 *
 * Scope: nodes and marks that have a clean OOXML mapping and no surrounding
 * resource registration beyond `<w:rPr>` and paragraph styles. Lists,
 * tables, images, hyperlinks, and track changes need additional plumbing
 * (numbering, drawing, rels) and ship as feature PRs.
 */

import { xml } from "./xml";
import type {
  DocxNodeHandler,
  DocxMarkHandler,
  DocxRunProps,
} from "./handlers";

const paragraphHandler: DocxNodeHandler = (_node, children) =>
  xml("w:p", undefined, children);

const hardBreakHandler: DocxNodeHandler = () =>
  xml("w:r", undefined, [xml("w:br")]);

/** Page break — Word renders as a forced page break inside a paragraph. */
const pageBreakHandler: DocxNodeHandler = () =>
  xml("w:p", undefined, [
    xml("w:r", undefined, [xml("w:br", { "w:type": "page" })]),
  ]);

/** Horizontal rule — empty paragraph with a bottom border. */
const horizontalRuleHandler: DocxNodeHandler = () =>
  xml("w:p", undefined, [
    xml("w:pPr", undefined, [
      xml("w:pBdr", undefined, [
        xml("w:bottom", {
          "w:val": "single",
          "w:sz": "6",
          "w:space": "1",
          "w:color": "auto",
        }),
      ]),
    ]),
  ]);

/** Code block — paragraph with code style (Courier New). */
const codeBlockHandler: DocxNodeHandler = (_node, children, ctx) => {
  const styleId = ctx.styles.paragraph.getOrCreate("Code Block", {
    font: "Courier New",
    size: 13,
  });
  return xml("w:p", undefined, [
    xml("w:pPr", undefined, [xml("w:pStyle", { "w:val": styleId })]),
    ...children,
  ]);
};

export const defaultDocxNodeHandlers: Record<string, DocxNodeHandler> = {
  paragraph: paragraphHandler,
  hardBreak: hardBreakHandler,
  pageBreak: pageBreakHandler,
  horizontalRule: horizontalRuleHandler,
  codeBlock: codeBlockHandler,
};

const boldMark: DocxMarkHandler = (props) => ({ ...props, bold: true });
const italicMark: DocxMarkHandler = (props) => ({ ...props, italic: true });
const underlineMark: DocxMarkHandler = (props) => ({ ...props, underline: true });
const strikethroughMark: DocxMarkHandler = (props) => ({ ...props, strike: true });
const codeMark: DocxMarkHandler = (props) => ({ ...props, code: true });

const colorMark: DocxMarkHandler = (props, mark) => {
  const value = readStringAttr(mark.attrs["color"]);
  return value ? { ...props, color: value } : props;
};

const highlightMark: DocxMarkHandler = (props, mark) => {
  const value =
    readStringAttr(mark.attrs["color"]) ?? readStringAttr(mark.attrs["highlight"]);
  return value ? { ...props, highlight: value } : props;
};

const fontSizeMark: DocxMarkHandler = (props, mark) => {
  const raw = mark.attrs["size"];
  return typeof raw === "number" ? { ...props, fontSize: raw } : props;
};

const fontFamilyMark: DocxMarkHandler = (props, mark) => {
  const value =
    readStringAttr(mark.attrs["family"]) ?? readStringAttr(mark.attrs["fontFamily"]);
  return value ? { ...props, fontFamily: value } : props;
};

function readStringAttr(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export const defaultDocxMarkHandlers: Record<string, DocxMarkHandler> = {
  bold: boldMark,
  italic: italicMark,
  underline: underlineMark,
  strikethrough: strikethroughMark,
  code: codeMark,
  color: colorMark,
  highlight: highlightMark,
  fontSize: fontSizeMark,
  fontFamily: fontFamilyMark,
};

/** Type-export to keep DocxRunProps reachable from this module's consumers. */
export type { DocxRunProps };
