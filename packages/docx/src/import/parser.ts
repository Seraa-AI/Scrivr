/**
 * Stage 1: parse `word/document.xml` into a `DocxImportModel` of normalized
 * paragraphs and inline runs. Knows nothing about ProseMirror — that's
 * Stage 2's job.
 *
 * Design notes (carried over from a review pass):
 *   - Preserve semantic intent. Hyperlinks survive as `link` marks
 *     carrying `relId`/`anchor`; Stage 2's Link extension resolves to a URL.
 *   - Degrade explicitly. When an anchored drawing has no recognized wrap
 *     element we default to `"square"` AND emit a diagnostic instead of
 *     silently picking.
 *   - Tolerate real Word output. Word interleaves bookmarks, proof errors,
 *     permission ranges, comment refs and similar metadata between/
 *     inside runs. The page-break detector ignores those rather than
 *     refusing to classify the paragraph.
 *   - Normalize boolean run properties at the boundary — `<w:b w:val="false"/>`
 *     drops the bold mark, never reaches Stage 2 as a phantom `b`.
 */

import {
  attr,
  findChild,
  findChildren,
  type OoxmlElement,
} from "./xml";
import type {
  DocxBlock,
  DocxDiagnostic,
  DocxImageInline,
  DocxImportModel,
  DocxInline,
  DocxMark,
  DocxParagraphAttrs,
  DocxTableCell,
  DocxTableRow,
} from "@scrivr/core";
import { emuToPx, twipsToPx } from "@scrivr/core";

/**
 * Minimal diagnostics sink — same shape `DocxImportContext.diagnostics`
 * exposes, but accepted as a standalone arg so parser tests can supply a
 * no-op without spinning up a full context.
 */
export interface ParserDiagnostics {
  warn(d: Omit<DocxDiagnostic, "level">): void;
}

const NULL_DIAGNOSTICS: ParserDiagnostics = { warn: () => {} };

export function parseDocumentBody(
  documentRoot: OoxmlElement,
  diagnostics: ParserDiagnostics = NULL_DIAGNOSTICS,
): DocxImportModel {
  const body = findChild(documentRoot, "w:body");
  if (!body) return { blocks: [] };

  const blocks: DocxBlock[] = [];
  for (const child of body.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:p") {
      if (isPageBreakParagraph(child)) {
        blocks.push({ type: "pageBreak" });
        continue;
      }
      if (isHorizontalRuleParagraph(child)) {
        blocks.push({ type: "horizontalRule" });
        continue;
      }
      // A paragraph with mid-text `<w:br w:type="page"/>` splits into:
      // {paragraph-before, pageBreak, paragraph-after}. parseParagraph
      // returns an array so the structural break survives Stage 2 as a
      // real `pageBreak` block instead of a stray inline.
      blocks.push(...parseParagraph(child, diagnostics));
    } else if (child.name === "w:tbl") {
      blocks.push(parseTable(child, diagnostics));
    } else if (child.name === "w:sectPr") {
      // Section properties — page size, margins, etc. Not modeled yet.
      continue;
    } else if (IGNORABLE_BODY_CHILDREN.has(child.name)) {
      continue;
    } else {
      diagnostics.warn({
        code: "unsupported-docx-element",
        message: `No parser for top-level body element <${child.name}> — dropped`,
        nodeType: child.name,
      });
    }
  }
  return { blocks };
}

/**
 * Body-level elements Word may emit that don't represent content: revision
 * markers and proof errors mostly. Anything outside this set that we don't
 * model produces an `unsupported-docx-element` diagnostic instead of a
 * silent drop.
 */
const IGNORABLE_BODY_CHILDREN = new Set([
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:proofErr",
  "w:permStart",
  "w:permEnd",
  "w:commentRangeStart",
  "w:commentRangeEnd",
]);

// ── Page-break detection ────────────────────────────────────────────────────

/**
 * Allowlist of harmless paragraph-level elements that Word interleaves
 * between content. None of these contain run content; ignoring them lets
 * `isPageBreakParagraph` work on real-world DOCX, not just clean fixtures.
 */
const IGNORABLE_PARAGRAPH_CHILDREN = new Set([
  "w:pPr",
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:proofErr",
  "w:permStart",
  "w:permEnd",
  "w:commentRangeStart",
  "w:commentRangeEnd",
  "w:commentReference",
  "w:smartTag",
]);

/**
 * Allowlist of harmless run-level elements that Word interleaves with
 * actual content. Required for tolerant page-break + run parsing.
 */
const IGNORABLE_RUN_CHILDREN = new Set([
  "w:rPr",
  "w:lastRenderedPageBreak",
  "w:proofErr",
  "w:bookmarkStart",
  "w:bookmarkEnd",
  "w:commentReference",
  "w:annotationRef",
]);

/**
 * Detect Word's "horizontal rule" convention — an otherwise empty
 * paragraph whose pPr carries a bottom border. Scrivr's HR exporter
 * emits exactly this shape; round-tripping needs the inverse.
 *
 * Only matches when the paragraph has no actual run content, so a real
 * paragraph that happens to have a bottom border (a styled callout, say)
 * stays a paragraph instead of collapsing to an HR.
 */
function isHorizontalRuleParagraph(el: OoxmlElement): boolean {
  const pPr = findChild(el, "w:pPr");
  if (!pPr) return false;
  const pBdr = findChild(pPr, "w:pBdr");
  if (!pBdr) return false;
  if (!findChild(pBdr, "w:bottom")) return false;
  return isEffectivelyEmpty(el);
}

/**
 * True when the paragraph carries no text/break/drawing content — only
 * pPr and metadata children. Shared between the page-break and HR
 * detectors; both need to look past the same set of Word interleavings.
 */
function isEffectivelyEmpty(el: OoxmlElement): boolean {
  for (const child of el.children) {
    if (typeof child === "string") {
      if (child.trim().length > 0) return false;
      continue;
    }
    if (IGNORABLE_PARAGRAPH_CHILDREN.has(child.name)) continue;
    if (child.name !== "w:r") return false;
    for (const inner of child.children) {
      if (typeof inner === "string") {
        if (inner.trim().length > 0) return false;
        continue;
      }
      if (IGNORABLE_RUN_CHILDREN.has(inner.name)) continue;
      return false; // any non-ignorable run child counts as content
    }
  }
  return true;
}

function isPageBreakParagraph(el: OoxmlElement): boolean {
  let foundPageBreak = false;
  for (const child of el.children) {
    if (typeof child === "string") {
      if (child.trim().length > 0) return false;
      continue;
    }
    if (IGNORABLE_PARAGRAPH_CHILDREN.has(child.name)) continue;
    if (child.name !== "w:r") return false;
    for (const inner of child.children) {
      if (typeof inner === "string") {
        if (inner.trim().length > 0) return false;
        continue;
      }
      if (IGNORABLE_RUN_CHILDREN.has(inner.name)) continue;
      if (inner.name === "w:br" && attr(inner, "w:type") === "page") {
        foundPageBreak = true;
        continue;
      }
      // Any other content (text, tab, normal break) — not a page break.
      return false;
    }
  }
  return foundPageBreak;
}

// ── Paragraph + inline-page-break split ────────────────────────────────────

/**
 * Parse a `<w:p>`. May return multiple blocks when a mid-paragraph
 * `<w:br w:type="page"/>` splits content. Most paragraphs yield exactly
 * one element.
 */
function parseParagraph(el: OoxmlElement, diag: ParserDiagnostics): DocxBlock[] {
  const attrs = parseParagraphProperties(el);
  const inlines = parseParagraphInlines(el, diag);
  return splitOnInlinePageBreaks(attrs, inlines);
}

/**
 * Parse a `<w:tbl>` into the intermediate table block. Mirrors the export in
 * `@scrivr/core`'s `table/docxExport.ts`: `<w:tblGrid>` → px column widths,
 * `<w:tr>` → rows, `<w:tc>` → cells with gridSpan / vMerge / shaded fill.
 * Cell content reuses the paragraph/table parsers so nested blocks round-trip.
 */
function parseTable(el: OoxmlElement, diag: ParserDiagnostics): DocxBlock {
  const grid: number[] = [];
  const tblGrid = findChild(el, "w:tblGrid");
  if (tblGrid) {
    for (const col of findChildren(tblGrid, "w:gridCol")) {
      const w = Number(attr(col, "w:w"));
      grid.push(Number.isFinite(w) ? Math.round(twipsToPx(w)) : 100);
    }
  }

  const rows: DocxTableRow[] = [];
  for (const tr of findChildren(el, "w:tr")) {
    const trPr = findChild(tr, "w:trPr");
    const repeatHeader = trPr ? findChild(trPr, "w:tblHeader") !== undefined : false;

    const cells: DocxTableCell[] = [];
    for (const tc of findChildren(tr, "w:tc")) {
      cells.push(parseTableCell(tc, diag));
    }
    rows.push({ repeatHeader, cells });
  }

  return { type: "table", grid, rows };
}

function parseTableCell(tc: OoxmlElement, diag: ParserDiagnostics): DocxTableCell {
  const tcPr = findChild(tc, "w:tcPr");

  let gridSpan = 1;
  let vMerge: DocxTableCell["vMerge"] = "none";
  let background: string | null = null;
  if (tcPr) {
    const gridSpanEl = findChild(tcPr, "w:gridSpan");
    if (gridSpanEl) {
      const span = Number(attr(gridSpanEl, "w:val"));
      if (Number.isInteger(span) && span >= 1) gridSpan = span;
    }

    const vm = findChild(tcPr, "w:vMerge");
    // OOXML quirk: a `<w:vMerge>` with no `w:val` means "continue".
    if (vm) vMerge = attr(vm, "w:val") === "restart" ? "restart" : "continue";

    const shd = findChild(tcPr, "w:shd");
    const fill = shd ? attr(shd, "w:fill") : undefined;
    if (fill && /^[0-9a-fA-F]{6}$/.test(fill)) background = `#${fill.toLowerCase()}`;
  }

  const content: DocxBlock[] = [];
  for (const child of tc.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:p") content.push(...parseParagraph(child, diag));
    else if (child.name === "w:tbl") content.push(parseTable(child, diag));
  }
  // A `<w:tc>` always holds at least one block in Word; guarantee it so the
  // schema's `block+` content requirement holds even for an empty cell.
  if (content.length === 0) content.push({ type: "paragraph", attrs: {}, content: [] });

  return { gridSpan, vMerge, background, isHeader: false, content };
}

function parseParagraphProperties(el: OoxmlElement): DocxParagraphAttrs {
  const attrs: DocxParagraphAttrs = {};
  const pPr = findChild(el, "w:pPr");
  if (!pPr) return attrs;

  const pStyle = findChild(pPr, "w:pStyle");
  const styleId = pStyle && attr(pStyle, "w:val");
  if (styleId) attrs.styleId = styleId;

  const jc = findChild(pPr, "w:jc");
  const jcVal = jc && attr(jc, "w:val");
  const aligned = jcVal ? normalizeAlign(jcVal) : undefined;
  if (aligned) attrs.align = aligned;

  const numPr = findChild(pPr, "w:numPr");
  if (numPr) {
    const ilvlEl = findChild(numPr, "w:ilvl");
    const numIdEl = findChild(numPr, "w:numId");
    const ilvlRaw = ilvlEl && attr(ilvlEl, "w:val");
    const numIdRaw = numIdEl && attr(numIdEl, "w:val");
    // Guard against malformed XML — `Number("abc") = NaN` would otherwise
    // poison every downstream comparison.
    const ilvl = ilvlRaw !== undefined ? Number(ilvlRaw) : NaN;
    const numId = numIdRaw !== undefined ? Number(numIdRaw) : NaN;
    if (Number.isInteger(ilvl) && Number.isInteger(numId)) {
      attrs.numbering = { numId, ilvl };
    }
  }

  return attrs;
}

function parseParagraphInlines(el: OoxmlElement, diag: ParserDiagnostics): DocxInline[] {
  const content: DocxInline[] = [];
  for (const child of el.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:r") {
      content.push(...parseRun(child, diag));
    } else if (child.name === "w:hyperlink") {
      // Preserve hyperlink identity by attaching a `link` mark to every
      // inline produced by its inner runs. Stage 2 (Link extension)
      // resolves the relId → URL via `ctx.rels.resolveHyperlink`.
      const linkMark = buildHyperlinkMark(child);
      for (const inner of child.children) {
        if (typeof inner === "string") continue;
        if (inner.name === "w:r") {
          for (const item of parseRun(inner, diag)) {
            content.push(addMark(item, linkMark));
          }
        }
      }
    }
  }
  return content;
}

function buildHyperlinkMark(hyperlink: OoxmlElement): DocxMark {
  const attrs: Record<string, unknown> = {};
  const relId = attr(hyperlink, "r:id");
  const anchor = attr(hyperlink, "w:anchor");
  const history = attr(hyperlink, "w:history");
  if (relId) attrs["relId"] = relId;
  if (anchor) attrs["anchor"] = anchor;
  if (history) attrs["history"] = history;
  return { kind: "hyperlink", attrs };
}

function addMark(inline: DocxInline, mark: DocxMark): DocxInline {
  return { ...inline, marks: [...inline.marks, mark] };
}

/**
 * Split a paragraph's inline stream at inline page-break sentinels and
 * emit `{ paragraph-before, pageBreak, paragraph-after, … }`. When no
 * page-break sentinels are present this returns a single-element array.
 *
 * The sentinel is `{ type: "pageBreak" }` masquerading as a DocxInline
 * to keep `parseRun`'s shape simple; we filter / split on it here.
 */
function splitOnInlinePageBreaks(
  attrs: DocxParagraphAttrs,
  inlines: DocxInline[],
): DocxBlock[] {
  const splits: DocxInline[][] = [[]];
  let hasPageBreak = false;
  for (const item of inlines) {
    if ((item as { type: string }).type === "pageBreak") {
      splits.push([]);
      hasPageBreak = true;
    } else {
      splits[splits.length - 1]!.push(item);
    }
  }
  if (!hasPageBreak) {
    return [{ type: "paragraph", attrs, content: inlines }];
  }
  const out: DocxBlock[] = [];
  for (let i = 0; i < splits.length; i++) {
    const slice = splits[i]!;
    // Empty slices around a page break still need a paragraph so the
    // visual rhythm matches Word — an empty paragraph before/after the
    // page break is what the user wrote.
    out.push({ type: "paragraph", attrs, content: slice });
    if (i < splits.length - 1) out.push({ type: "pageBreak" });
  }
  return out;
}

// ── Run parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a `<w:r>` into a sequence of inline events. A single run can
 * produce multiple `DocxInline` items because text + break + text
 * inside one run becomes three events sharing the same mark stack.
 *
 * Note: `pageBreak` events flow through here as a sentinel shape
 * (`{ type: "pageBreak", marks }`); `parseParagraph` consumes the
 * sentinel and splits the surrounding paragraph.
 */
function parseRun(el: OoxmlElement, diag: ParserDiagnostics): DocxInline[] {
  const rPr = findChild(el, "w:rPr");
  const marks: DocxMark[] = rPr ? parseRunProperties(rPr) : [];
  const out: DocxInline[] = [];
  for (const child of el.children) {
    if (typeof child === "string") continue;
    if (IGNORABLE_RUN_CHILDREN.has(child.name)) continue;
    if (child.name === "w:t") {
      const text = readWordText(child);
      if (text.length > 0) out.push({ type: "text", text, marks });
    } else if (child.name === "w:br") {
      const breakType = attr(child, "w:type");
      if (breakType === "page") {
        // Sentinel — paragraph parser splits on this.
        out.push({ type: "pageBreak", marks } as unknown as DocxInline);
      } else {
        out.push({ type: "hardBreak", marks });
      }
    } else if (child.name === "w:tab") {
      out.push({ type: "text", text: "\t", marks });
    } else if (child.name === "w:drawing") {
      const image = parseDrawing(child, marks, diag);
      if (image) out.push(image);
    }
  }
  return out;
}

// ── Drawing / image parsing ────────────────────────────────────────────────

/**
 * Parse a `<w:drawing>` into a `DocxImageInline`. Handles both
 * `<wp:inline>` and `<wp:anchor>` wrappers. Reads:
 *   - `<a:blip r:embed="rId5"/>` → relId (deep lookup so OOXML
 *     variations like `<mc:AlternateContent>` don't break detection)
 *   - `<wp:extent cx cy/>` → width / height (EMU → px)
 *   - anchor's wrap element → wrapMode (square/top-bottom/behind/front)
 *   - `<wp:positionH>` / `<wp:positionV>` → xAlign / x / yOffset
 *   - position `relativeFrom` preserved verbatim for future fidelity
 */
function parseDrawing(
  el: OoxmlElement,
  marks: DocxMark[],
  diag: ParserDiagnostics,
): DocxImageInline | null {
  const wrapper = findChild(el, "wp:inline") ?? findChild(el, "wp:anchor");
  if (!wrapper) return null;

  const blip = findDescendant(wrapper, "a:blip");
  const relId = blip && attr(blip, "r:embed");
  if (!relId) return null;

  const extent = findChild(wrapper, "wp:extent");
  const cx = extent ? Number(attr(extent, "cx") ?? "") : NaN;
  const cy = extent ? Number(attr(extent, "cy") ?? "") : NaN;
  const width = Number.isFinite(cx) && cx > 0 ? Math.round(emuToPx(cx)) : undefined;
  const height = Number.isFinite(cy) && cy > 0 ? Math.round(emuToPx(cy)) : undefined;

  if (wrapper.name === "wp:inline") {
    const image: DocxImageInline = { type: "image", relId, marks, wrapMode: "inline" };
    if (width !== undefined) image.width = width;
    if (height !== undefined) image.height = height;
    return image;
  }

  // Anchored — five-mode mapping mirrors the export side.
  const behindDoc = attr(wrapper, "behindDoc") === "1";
  let wrapMode: DocxImageInline["wrapMode"] | undefined;
  if (findChild(wrapper, "wp:wrapSquare")) wrapMode = "square";
  else if (findChild(wrapper, "wp:wrapTopAndBottom")) wrapMode = "top-bottom";
  else if (findChild(wrapper, "wp:wrapTight")) wrapMode = "square"; // tight → square fallback
  else if (findChild(wrapper, "wp:wrapNone")) wrapMode = behindDoc ? "behind" : "front";
  if (!wrapMode) {
    wrapMode = "square";
    diag.warn({
      code: "docx.image.missingWrapMode",
      message: "Anchored image had no recognized wrap element; defaulted to square",
      nodeType: "image",
    });
  }

  const horizontal = parsePositionH(findChild(wrapper, "wp:positionH"));
  const vertical = parsePositionV(findChild(wrapper, "wp:positionV"));

  const image: DocxImageInline = { type: "image", relId, marks, wrapMode };
  if (width !== undefined) image.width = width;
  if (height !== undefined) image.height = height;
  if (horizontal.xAlign) image.xAlign = horizontal.xAlign;
  if (horizontal.x !== undefined) image.x = horizontal.x;
  if (horizontal.relativeFrom) image.xRelativeFrom = horizontal.relativeFrom;
  if (vertical.yOffset !== undefined) image.yOffset = vertical.yOffset;
  if (vertical.relativeFrom) image.yRelativeFrom = vertical.relativeFrom;
  return image;
}

interface ParsedPositionH {
  xAlign?: DocxImageInline["xAlign"];
  x?: number;
  relativeFrom?: string;
}

function parsePositionH(el: OoxmlElement | undefined): ParsedPositionH {
  if (!el) return {};
  const out: ParsedPositionH = {};
  const relativeFrom = attr(el, "relativeFrom");
  if (relativeFrom) out.relativeFrom = relativeFrom;
  const align = findChild(el, "wp:align");
  const posOffset = findChild(el, "wp:posOffset");
  if (align) {
    const txt = readTextChildren(align).trim();
    if (txt === "left" || txt === "center" || txt === "right") out.xAlign = txt;
  } else if (posOffset) {
    const emu = Number(readTextChildren(posOffset).trim());
    if (Number.isFinite(emu)) {
      out.xAlign = "custom";
      out.x = Math.round(emuToPx(emu));
    }
  }
  return out;
}

interface ParsedPositionV {
  yOffset?: number;
  relativeFrom?: string;
}

function parsePositionV(el: OoxmlElement | undefined): ParsedPositionV {
  if (!el) return {};
  const out: ParsedPositionV = {};
  const relativeFrom = attr(el, "relativeFrom");
  if (relativeFrom) out.relativeFrom = relativeFrom;
  const posOffset = findChild(el, "wp:posOffset");
  if (posOffset) {
    const emu = Number(readTextChildren(posOffset).trim());
    if (Number.isFinite(emu)) out.yOffset = Math.round(emuToPx(emu));
  }
  return out;
}

function readTextChildren(el: OoxmlElement): string {
  let out = "";
  for (const c of el.children) {
    if (typeof c === "string") out += c;
  }
  return out;
}

/**
 * Recursive descendant lookup. Looser than the fixed graphic path in
 * earlier revisions — real-world OOXML wraps the picture in
 * `<mc:AlternateContent>` / `<mc:Choice>` blocks the rigid path missed.
 */
function findDescendant(el: OoxmlElement, name: string): OoxmlElement | undefined {
  for (const child of el.children) {
    if (typeof child === "string") continue;
    if (child.name === name) return child;
    const found = findDescendant(child, name);
    if (found) return found;
  }
  return undefined;
}

// ── Run properties → DocxMark ──────────────────────────────────────────────

/**
 * `<w:rPr>` children that are toggle properties (on/off booleans).
 * `<w:b w:val="false"/>` means "explicitly NOT bold" — these never
 * become marks, regardless of which extension claims them.
 */
const TOGGLE_RPR_KINDS = new Set([
  "b", "bCs",
  "i", "iCs",
  "strike", "dstrike",
  "u",         // val="none" handled the same way
  "caps", "smallCaps",
  "shadow", "outline", "emboss", "imprint",
  "vanish",
]);

function parseOnOff(value: string | undefined): boolean {
  if (value === undefined) return true;
  return value !== "false" && value !== "0" && value !== "off";
}

function parseRunProperties(rPr: OoxmlElement): DocxMark[] {
  const marks: DocxMark[] = [];
  for (const child of rPr.children) {
    if (typeof child === "string") continue;
    const kind = stripNamespace(child.name);

    if (TOGGLE_RPR_KINDS.has(kind)) {
      const val = attr(child, "w:val");
      // `<w:u w:val="none"/>` explicitly cancels underline; same pattern
      // for the rest. Skip the mark entirely so Stage 2 never sees a
      // phantom toggle.
      if (kind === "u" && val === "none") continue;
      if (!parseOnOff(val)) continue;
      // Drop the val attr for toggles since "on" is the absence of any
      // value semantically.
      marks.push({ kind, attrs: {} });
      continue;
    }

    const attrs: Record<string, unknown> = {};
    for (const k of Object.keys(child.attrs)) attrs[stripNamespace(k)] = child.attrs[k];
    marks.push({ kind, attrs });
  }
  return marks;
}

function stripNamespace(qualified: string): string {
  const colon = qualified.indexOf(":");
  return colon >= 0 ? qualified.slice(colon + 1) : qualified;
}

/**
 * Read the raw text of a `<w:t>`. The underlying XML parser is configured
 * with `trimValues: false` so leading / trailing whitespace already
 * survives the parse step — Word's explicit `xml:space="preserve"` is
 * effectively a no-op for us. Kept as a function so the call site stays
 * readable and the contract has somewhere to grow if we ever swap parsers.
 */
function readWordText(t: OoxmlElement): string {
  let out = "";
  for (const c of t.children) {
    if (typeof c === "string") out += c;
  }
  return out;
}

function normalizeAlign(jc: string): DocxParagraphAttrs["align"] {
  if (jc === "center") return "center";
  if (jc === "right" || jc === "end") return "right";
  if (jc === "both" || jc === "distribute" || jc === "justify") return "justify";
  return "left";
}

// Helpers re-exported for tests + extension parsers.
export { findChild, findChildren, attr };
export type { OoxmlElement };
