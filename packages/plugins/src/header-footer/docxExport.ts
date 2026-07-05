/**
 * DOCX export for page headers/footers — the extension owns "how it exports"
 * through `addExports().docx`, so `@scrivr/docx` stays free of header/footer
 * knowledge (mirrors `pdfExport.ts` and `table/docxExport.ts`).
 *
 * Each active slot becomes a `word/header{n}.xml` / `footer{n}.xml` part
 * (`ctx.parts.add`), its content walked through the same handlers as the body
 * (`ctx.walkContent`). References are injected into the body `<w:sectPr>`:
 *
 *   <w:sectPr>
 *     <w:headerReference w:type="default|first" r:id="…"/>
 *     <w:footerReference …/>
 *     … pgSz / pgMar …
 *     [<w:titlePg/>]        (differentFirstPage)
 *   </w:sectPr>
 *
 * Dynamic tokens export as Word field codes so they stay live in the document.
 */
import {
  xml,
  prepareDocxImages,
  type DocxContext,
  type DocxHandlers,
  type XmlNode,
} from "@scrivr/core";
import type { Node } from "prosemirror-model";
import { getHeaderFooterPolicy } from "./getPolicy";
import type { HeaderFooterDefinition, HeaderFooterPolicy } from "./types";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A `<w:fldSimple>` field with a fallback run (what Word shows until it recalcs). */
function field(instr: string, fallback: string): XmlNode {
  return xml("w:fldSimple", { "w:instr": instr }, [
    xml("w:r", undefined, [xml("w:t", undefined, [fallback])]),
  ]);
}

/** Node handlers for the dynamic header/footer tokens → live Word fields. */
const tokenNodeHandlers: NonNullable<DocxHandlers["nodes"]> = {
  pageNumber: () => field(" PAGE ", "1"),
  totalPages: () => field(" NUMPAGES ", "1"),
  date: () => field(" DATE ", ""),
};

interface SlotRef {
  kind: "header" | "footer";
  type: "default" | "first" | "even";
  relId: string;
}

interface SlotSpec {
  def: HeaderFooterDefinition;
  kind: "header" | "footer";
  type: SlotRef["type"];
}

/** The active slots for a policy — the single source both passes iterate. */
function activeSlotSpecs(policy: HeaderFooterPolicy): SlotSpec[] {
  const specs: SlotSpec[] = [];
  const add = (
    def: HeaderFooterDefinition | undefined,
    kind: SlotSpec["kind"],
    type: SlotSpec["type"],
  ): void => {
    if (def) specs.push({ def, kind, type });
  };
  add(policy.defaultHeader, "header", "default");
  add(policy.defaultFooter, "footer", "default");
  if (policy.differentFirstPage) {
    add(policy.firstPageHeader, "header", "first");
    add(policy.firstPageFooter, "footer", "first");
  }
  if (policy.differentOddEven) {
    add(policy.evenPageHeader, "header", "even");
    add(policy.evenPageFooter, "footer", "even");
  }
  return specs;
}

/** Walk one slot into a `<w:hdr>`/`<w:ftr>` part and record its reference. */
function addSlot(ctx: DocxContext, spec: SlotSpec, refs: SlotRef[]): void {
  const { def, kind, type } = spec;
  const doc = parseSlot(ctx, def, kind, type);
  if (!doc) return;
  // The walk runs inside `parts.add` so any images it emits are scoped to this
  // part's rels (word/_rels/header1.xml.rels). Word requires a
  // `<w:hdr>`/`<w:ftr>` to hold at least one block element.
  const { relId } = ctx.parts.add({
    kind,
    build: () => {
      const body = ctx.walkContent(doc);
      return xml(
        kind === "header" ? "w:hdr" : "w:ftr",
        { "xmlns:w": W_NS, "xmlns:r": R_NS },
        body.length > 0 ? body : [xml("w:p")],
      );
    },
  });
  refs.push({ kind, type, relId });
}

/** Parse a slot's stored ProseMirror JSON into a document node, or warn. */
function parseSlot(
  ctx: DocxContext,
  def: HeaderFooterDefinition,
  kind: "header" | "footer",
  type: SlotRef["type"],
): Node | null {
  try {
    return ctx.editor.schema.nodeFromJSON(def.content);
  } catch {
    ctx.diagnostics.warn({
      code: "header-footer-content",
      message: `Could not parse ${type} ${kind} content — skipped.`,
    });
    return null;
  }
}

/** Find a child element by name on an `XmlNode`. */
function childEl(node: XmlNode, name: string): XmlNode | undefined {
  return node.children?.find(
    (c): c is XmlNode => typeof c !== "string" && c.name === name,
  );
}

/** Inject the header/footer references (and titlePg) into the body `<w:sectPr>`. */
function injectSectPr(ctx: DocxContext, refs: SlotRef[], differentFirstPage: boolean): void {
  const body = childEl(ctx.document, "w:body");
  const sectPr = body ? childEl(body, "w:sectPr") : undefined;
  if (!sectPr) return;

  const refNodes = refs.map((r) =>
    xml(r.kind === "header" ? "w:headerReference" : "w:footerReference", {
      "w:type": r.type,
      "r:id": r.relId,
    }),
  );
  // References lead the sectPr; titlePg trails (schema order: refs → pgSz/pgMar → titlePg).
  const trailing = differentFirstPage ? [xml("w:titlePg")] : [];
  sectPr.children = [...refNodes, ...(sectPr.children ?? []), ...trailing];
}

function buildHeaderFooterParts(ctx: DocxContext): void {
  const policy: HeaderFooterPolicy | null = getHeaderFooterPolicy(ctx.editor.getState().doc);
  if (!policy || !policy.enabled) return;

  const refs: SlotRef[] = [];
  for (const spec of activeSlotSpecs(policy)) addSlot(ctx, spec, refs);
  if (policy.differentOddEven) ctx.settings.enableEvenAndOddHeaders();
  if (refs.length === 0) return;

  injectSectPr(ctx, refs, policy.differentFirstPage);
}

/**
 * Async pre-pass: fetch every image in the active header/footer slots into the
 * document-global media pool, mirroring the body image pre-pass. The bytes must
 * be resolved here (async) because the part walk in `buildHeaderFooterParts`
 * runs in a sync lifecycle hook; the per-part relationship is still allocated
 * there, at emit time.
 */
async function prepareHeaderFooterImages(ctx: DocxContext): Promise<void> {
  const policy = getHeaderFooterPolicy(ctx.editor.getState().doc);
  if (!policy || !policy.enabled) return;
  for (const spec of activeSlotSpecs(policy)) {
    const doc = parseSlot(ctx, spec.def, spec.kind, spec.type);
    if (doc) await prepareDocxImages(ctx, doc);
  }
}

/** `addExports().docx` contribution for the HeaderFooter extension. */
export const headerFooterDocxHandlers: DocxHandlers = {
  nodes: tokenNodeHandlers,
  onBeforeExport: prepareHeaderFooterImages,
  onBuildTreeComplete: buildHeaderFooterParts,
};
