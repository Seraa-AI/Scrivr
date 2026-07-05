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
  if (!nodeName) return null;
  const type = ctx.schema.nodes[nodeName];
  return type ? type.create() : null;
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
  | "defaultHeader" | "firstPageHeader"
  | "defaultFooter" | "firstPageFooter";

function slotKey(
  kind: "header" | "footer",
  type: "default" | "first" | "even",
): SlotKey | null {
  // v1 policy models default + first only; "even" is exported by nothing yet.
  if (type === "even") return null;
  if (kind === "header") return type === "first" ? "firstPageHeader" : "defaultHeader";
  return type === "first" ? "firstPageFooter" : "defaultFooter";
}

function importHeaderFooter(doc: PmNode, ctx: DocxImportContext): PmNode {
  const refs = [
    ...ctx.section.headers.map((r) => ({ ...r, kind: "header" as const })),
    ...ctx.section.footers.map((r) => ({ ...r, kind: "footer" as const })),
  ];
  if (refs.length === 0) return doc;

  const slots: Partial<Record<SlotKey, HeaderFooterDefinition>> = {};
  let differentFirstPage = false;
  for (const ref of refs) {
    const key = slotKey(ref.kind, ref.type);
    if (!key) continue;
    const part = ctx.walkPart(ref.relId);
    if (!part) continue;
    slots[key] = { content: partToContent(part) };
    if (ref.type === "first") differentFirstPage = true;
  }

  if (Object.keys(slots).length === 0) return doc;

  const policy: HeaderFooterPolicy = {
    enabled: true,
    differentFirstPage,
    differentOddEven: false,
    ...slots,
  };
  return doc.type.create({ ...doc.attrs, headerFooter: policy }, doc.content, doc.marks);
}

/** `addImports().docx` contribution for the HeaderFooter extension. */
export const headerFooterDocxImportHandlers: DocxImports = {
  inlines: { field: fieldInlineHandler },
  onImportComplete: importHeaderFooter,
};
