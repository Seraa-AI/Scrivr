/**
 * Stage 1: parse `word/document.xml` into a `DocxImportModel` of normalized
 * paragraphs and inline runs. Knows nothing about ProseMirror — that's
 * Stage 2's job.
 *
 * Current MVP scope: paragraph + text + `<w:tab/>`/`<w:br/>` inside runs.
 * Marks, headings, lists, images, tables come in subsequent commits.
 */

import {
  attr,
  findChild,
  findChildren,
  type OoxmlElement,
} from "./xml";
import type {
  DocxBlock,
  DocxImportModel,
  DocxInline,
  DocxMark,
  DocxParagraphAttrs,
  DocxImageInline,
} from "@scrivr/core";
import { emuToPx } from "@scrivr/core";

export function parseDocumentBody(documentRoot: OoxmlElement): DocxImportModel {
  const body = findChild(documentRoot, "w:body");
  if (!body) return { blocks: [] };

  const blocks: DocxBlock[] = [];
  for (const child of body.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:p") {
      // Word's hard page break: `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`.
      // Detect at the parser layer so the Stage-2 dispatcher gets a real
      // `pageBreak` block, not a paragraph with a hardBreak inside.
      if (isPageBreakParagraph(child)) {
        blocks.push({ type: "pageBreak" });
        continue;
      }
      blocks.push(parseParagraph(child));
    } else if (child.name === "w:sectPr") {
      // Section properties — page size, margins, etc. Not modeled yet.
      continue;
    }
    // Tables, sdt, etc. — future commits.
  }
  return { blocks };
}

/**
 * True when a `<w:p>` is structurally a Word page break — at least one
 * `<w:r><w:br w:type="page"/></w:r>`, no other text content.
 */
function isPageBreakParagraph(el: OoxmlElement): boolean {
  let foundPageBreak = false;
  for (const child of el.children) {
    if (typeof child === "string") {
      if (child.trim().length > 0) return false;
      continue;
    }
    if (child.name === "w:pPr") continue;
    if (child.name !== "w:r") return false;
    for (const inner of child.children) {
      if (typeof inner === "string") {
        if (inner.trim().length > 0) return false;
        continue;
      }
      if (inner.name === "w:rPr") continue;
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

function parseParagraph(el: OoxmlElement): DocxBlock {
  const attrs: DocxParagraphAttrs = {};
  const pPr = findChild(el, "w:pPr");
  if (pPr) {
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
      const ilvl = ilvlEl && attr(ilvlEl, "w:val");
      const numId = numIdEl && attr(numIdEl, "w:val");
      if (ilvl !== undefined && numId !== undefined) {
        attrs.numbering = { numId: Number(numId), ilvl: Number(ilvl) };
      }
    }
  }

  const content: DocxInline[] = [];
  for (const child of el.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:r") {
      content.push(...parseRun(child));
    } else if (child.name === "w:hyperlink") {
      // Hyperlink wrapper — flatten its runs for now (link mark comes later).
      for (const inner of child.children) {
        if (typeof inner === "string") continue;
        if (inner.name === "w:r") content.push(...parseRun(inner));
      }
    }
  }
  return { type: "paragraph", attrs, content };
}

/**
 * Parse a `<w:r>` (run). One run can produce multiple `DocxInline` items
 * because `<w:br/>` interleaved with `<w:t>` translates to text + hardBreak
 * + text. All output items share the same merged mark list.
 */
function parseRun(el: OoxmlElement): DocxInline[] {
  const rPr = findChild(el, "w:rPr");
  const marks: DocxMark[] = rPr ? parseRunProperties(rPr) : [];
  const out: DocxInline[] = [];
  for (const child of el.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:t") {
      const text = readWordText(child);
      if (text.length > 0) out.push({ type: "text", text, marks });
    } else if (child.name === "w:br") {
      // `w:type="page"` would be detected as a pageBreak block at the
      // paragraph level (see `isPageBreakParagraph`); inside a run we
      // treat it as a regular hard break.
      out.push({ type: "hardBreak", marks });
    } else if (child.name === "w:tab") {
      out.push({ type: "text", text: "\t", marks });
    } else if (child.name === "w:drawing") {
      const image = parseDrawing(child, marks);
      if (image) out.push(image);
    }
  }
  return out;
}

/**
 * Parse a `<w:drawing>` into a `DocxImageInline`. Handles both
 * `<wp:inline>` and `<wp:anchor>` wrappers. Reads:
 *   - `<a:blip r:embed="rId5"/>` → relId
 *   - `<wp:extent cx cy/>` → width / height (EMU → px)
 *   - anchor's wrap element → wrapMode (square/top-bottom/behind/front)
 *   - `<wp:positionH>` → xAlign / x
 *   - `<wp:positionV>` → yOffset
 */
function parseDrawing(el: OoxmlElement, marks: DocxMark[]): DocxImageInline | null {
  // Find either wp:inline or wp:anchor.
  const wrapper =
    findChild(el, "wp:inline") ?? findChild(el, "wp:anchor");
  if (!wrapper) return null;

  // Resolve r:embed via the deeply-nested <a:blip>. The graphic chain is:
  // wp:* > a:graphic > a:graphicData > pic:pic > pic:blipFill > a:blip.
  const graphic = findChild(wrapper, "a:graphic");
  const graphicData = graphic && findChild(graphic, "a:graphicData");
  const pic = graphicData && findChild(graphicData, "pic:pic");
  const blipFill = pic && findChild(pic, "pic:blipFill");
  const blip = blipFill && findChild(blipFill, "a:blip");
  const relId = blip && attr(blip, "r:embed");
  if (!relId) return null;

  const extent = findChild(wrapper, "wp:extent");
  const cx = extent ? Number(attr(extent, "cx") ?? "0") : NaN;
  const cy = extent ? Number(attr(extent, "cy") ?? "0") : NaN;
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
  let wrapMode: DocxImageInline["wrapMode"] = "square";
  if (findChild(wrapper, "wp:wrapSquare")) wrapMode = "square";
  else if (findChild(wrapper, "wp:wrapTopAndBottom")) wrapMode = "top-bottom";
  else if (findChild(wrapper, "wp:wrapTight")) wrapMode = "square"; // tight → square fallback
  else if (findChild(wrapper, "wp:wrapNone")) wrapMode = behindDoc ? "behind" : "front";

  let xAlign: DocxImageInline["xAlign"] | undefined;
  let xValue: number | undefined;
  const positionH = findChild(wrapper, "wp:positionH");
  if (positionH) {
    const align = findChild(positionH, "wp:align");
    const posOffset = findChild(positionH, "wp:posOffset");
    if (align) {
      const alignTxt = readTextChildren(align).trim();
      if (alignTxt === "center" || alignTxt === "right" || alignTxt === "left") {
        xAlign = alignTxt;
      }
    } else if (posOffset) {
      const emu = Number(readTextChildren(posOffset).trim());
      if (Number.isFinite(emu)) {
        xAlign = "custom";
        xValue = Math.round(emuToPx(emu));
      }
    }
  }

  let yOffset: number | undefined;
  const positionV = findChild(wrapper, "wp:positionV");
  if (positionV) {
    const posOffset = findChild(positionV, "wp:posOffset");
    if (posOffset) {
      const emu = Number(readTextChildren(posOffset).trim());
      if (Number.isFinite(emu)) yOffset = Math.round(emuToPx(emu));
    }
  }

  const image: DocxImageInline = { type: "image", relId, marks, wrapMode };
  if (width !== undefined) image.width = width;
  if (height !== undefined) image.height = height;
  if (xAlign) image.xAlign = xAlign;
  if (xValue !== undefined) image.x = xValue;
  if (yOffset !== undefined) image.yOffset = yOffset;
  return image;
}

function readTextChildren(el: OoxmlElement): string {
  let out = "";
  for (const c of el.children) {
    if (typeof c === "string") out += c;
  }
  return out;
}

/**
 * Convert `<w:rPr>` to a list of `DocxMark`. MVP: shape only — extensions
 * own which OOXML run-property elements become which Scrivr marks. Stage 2
 * dispatches by `mark.kind` so unknown kinds drop with a diagnostic.
 */
function parseRunProperties(rPr: OoxmlElement): DocxMark[] {
  const marks: DocxMark[] = [];
  for (const child of rPr.children) {
    if (typeof child === "string") continue;
    // Booleans: w:b, w:i, w:strike, w:u (val=single), etc.
    // Attr-bearing: w:color (w:val), w:highlight (w:val), w:shd (w:fill),
    //               w:sz (w:val half-points), w:rFonts (w:ascii).
    // Just normalize the kind + attrs; Stage 2 decides what survives.
    const kind = stripNamespace(child.name);
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
 * Read the text content of a `<w:t>` element. Honors `xml:space="preserve"`:
 * Word may set it explicitly, and our serializer does too — leaving leading/
 * trailing whitespace intact when the attr is present is what makes
 * round-tripping correct.
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
