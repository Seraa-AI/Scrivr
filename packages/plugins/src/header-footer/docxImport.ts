/**
 * DOCX import for page headers/footers — the inverse of `docxExport.ts`.
 *
 * The docx package exposes the section's header/footer references
 * (`ctx.section`) and a part walker (`ctx.walkPart`) that reconstructs a
 * part's content through the same handlers as the body. This contribution
 * reads those, rebuilds a `HeaderFooterPolicy`, and stores it on the imported
 * doc's `headerFooter` attribute — so a document exported by Scrivr (or any
 * DOCX using the `<w:fldSimple>` field form) round-trips its chrome.
 */
import type {
  DocxImportContext,
  DocxImports,
  DocxInlineTransform,
} from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import type {
  HeaderFooterContent,
  HeaderFooterDefinition,
  HeaderFooterPolicy,
} from "./types";

/** Field instruction keyword → the token node that regenerates it. */
const FIELD_TOKEN_NODES: Record<string, string> = {
  PAGE: "pageNumber",
  NUMPAGES: "totalPages",
  DATE: "date",
};

/**
 * Map a `<w:fldSimple>` field back to its token node. `instr` is the raw
 * instruction (` PAGE `, ` NUMPAGES `, ` DATE `); the first keyword selects
 * the node. Unknown fields drop (the walker records the diagnostic).
 */
const fieldInlineHandler: DocxInlineTransform = (inline, _marks, ctx) => {
  if (inline.type !== "field") return null;
  const keyword = inline.instr.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  const nodeName = FIELD_TOKEN_NODES[keyword];
  if (!nodeName) {
    ctx.diagnostics.warn({
      code: "unsupported-docx-field",
      message: `Unsupported DOCX field "${inline.instr.trim()}" — dropped`,
    });
    return null;
  }
  const type = ctx.schema.nodes[nodeName];
  if (type) return type.create();
  ctx.diagnostics.warn({
    code: "field-node-missing",
    message: `DOCX field "${keyword}" requires schema node "${nodeName}" — dropped`,
  });
  return null;
};

/** A walked part → the `HeaderFooterContent` JSON the policy stores. */
function partToContent(part: PmNode): HeaderFooterContent {
  const content: Record<string, unknown>[] = [];
  for (let i = 0; i < part.childCount; i++) {
    const json = part.child(i).toJSON();
    if (json && typeof json === "object") content.push(json);
  }
  return { type: "doc", content };
}

/** Which policy slot a reference fills, keyed by kind + `w:type`. */
type SlotKey =
  | "defaultHeader" | "firstPageHeader" | "evenPageHeader"
  | "defaultFooter" | "firstPageFooter" | "evenPageFooter";

function slotKey(
  kind: "header" | "footer",
  type: "default" | "first" | "even",
): SlotKey {
  if (kind === "header") {
    return type === "first" ? "firstPageHeader"
      : type === "even" ? "evenPageHeader"
      : "defaultHeader";
  }
  return type === "first" ? "firstPageFooter"
    : type === "even" ? "evenPageFooter"
    : "defaultFooter";
}

function importHeaderFooter(doc: PmNode, ctx: DocxImportContext): PmNode {
  const refs = [
    ...ctx.section.headers.map((r) => ({ ...r, kind: "header" as const })),
    ...ctx.section.footers.map((r) => ({ ...r, kind: "footer" as const })),
  ];
  if (refs.length === 0) return doc;

  const slots: Partial<Record<SlotKey, HeaderFooterDefinition>> = {};
  for (const ref of refs) {
    const part = ctx.walkPart(ref.relId);
    if (!part) continue;
    slots[slotKey(ref.kind, ref.type)] = { content: partToContent(part) };
  }

  if (Object.keys(slots).length === 0) return doc;

  // The activation flags come from the section, not the mere presence of a
  // reference: <w:titlePg> gates first-page chrome, <w:evenAndOddHeaders>
  // gates even-page chrome. A reference can exist while inactive.
  const policy: HeaderFooterPolicy = {
    enabled: true,
    differentFirstPage: ctx.section.titlePg,
    differentOddEven: ctx.section.evenAndOdd,
    ...slots,
  };
  return doc.type.create({ ...doc.attrs, headerFooter: policy }, doc.content, doc.marks);
}

/** `addImports().docx` contribution for the HeaderFooter extension. */
export const headerFooterDocxImportHandlers: DocxImports = {
  inlines: { field: fieldInlineHandler },
  onImportComplete: importHeaderFooter,
};
