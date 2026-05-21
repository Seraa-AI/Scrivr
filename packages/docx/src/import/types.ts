/**
 * Intermediate import model — normalized DOCX intent, between OOXML and
 * ProseMirror. Stage 1 of the importer produces these; Stage 2 (extension-
 * driven) maps them to schema-specific ProseMirror JSON.
 *
 * Why an intermediate layer:
 *   - Lists are flat-with-numbering in OOXML, nested in ProseMirror. The
 *     middle model is where the reconstruction pass lives.
 *   - Marks accumulate from multiple `<w:rPr>` children. The middle model
 *     normalizes them into a list before extensions claim them.
 *   - Schema isn't known to Stage 1 — handlers operate on this model
 *     regardless of which extensions are loaded.
 */

/** A normalized mark — `kind` is OOXML-vocabulary (e.g. `"bold"`), not PM. */
export interface DocxMark {
  kind: string;
  attrs?: Record<string, unknown>;
}

export type DocxInline =
  | { type: "text"; text: string; marks: DocxMark[] }
  | { type: "hardBreak"; marks: DocxMark[] }
  | { type: "image"; src: string; width?: number; height?: number; marks: DocxMark[] };

export interface DocxParagraphAttrs {
  /** Paragraph style ID — `Heading1`, `Normal`, etc. Resolved from styles.xml. */
  styleId?: string;
  /** `<w:pPr><w:jc w:val="left|center|right|both"/>`. */
  align?: "left" | "center" | "right" | "justify";
  /** `<w:numPr>` info — paragraph belongs to a list. */
  numbering?: { numId: number; ilvl: number };
  /** Hint that the paragraph was originally a Word page break. */
  pageBreakBefore?: boolean;
}

export type DocxBlock =
  | { type: "paragraph"; attrs: DocxParagraphAttrs; content: DocxInline[] }
  | { type: "horizontalRule" }
  | { type: "pageBreak" };

export interface DocxImportModel {
  blocks: DocxBlock[];
}
