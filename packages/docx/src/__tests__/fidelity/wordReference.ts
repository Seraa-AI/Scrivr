import { twipsToPx } from "@scrivr/core";
import { readDocxPackage } from "../../import/opc";
import { findChild, parseOoxml, textContent, type OoxmlElement } from "../../import/xml";

/**
 * What Word recorded in a `.docx` about its own layout, read straight from the
 * file — the reference the fidelity suite measures Scrivr against.
 *
 * Word cannot run in CI, and its layout engine is not specified, but every
 * file it saves carries the page size and margins it used, where each page
 * started when it was last saved (`w:lastRenderedPageBreak`), and the
 * formatting of every paragraph. Those are exact for what they cover.
 *
 * A text box is written twice: once in `mc:Choice` and again, as VML, in
 * `mc:Fallback`. Text and paragraphs are read from the first and never the
 * second, so a text box counts once; page starts skip text boxes altogether,
 * since they sit outside the flow of pages.
 */

export interface WordPageSetup {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface WordReference {
  /** The page of the document's last section, or `null` when it sets none. */
  page: WordPageSetup | null;
  /** The text each page after the first starts with, as Word last paginated it. */
  pageStarts: string[];
  /** Non-blank characters of body text, text boxes included. */
  textChars: number;
  /** `<Pages>` from `docProps/app.xml` — often stale, so a cross-check only. */
  pages: number | null;
}

/** Read Word's account of a document. */
export function readWordReference(bytes: Uint8Array): WordReference {
  const pkg = readDocxPackage(bytes);
  const body = documentBody(pkg.readText("word/document.xml"));
  const pagesXml = pkg.readText("docProps/app.xml");
  const pages = pagesXml ? /<Pages>(\d+)<\/Pages>/.exec(pagesXml)?.[1] : undefined;
  return {
    page: pageSetup(body),
    pageStarts: wordPageStarts(body),
    textChars: nonBlankCount(bodyText(body)),
    pages: pages === undefined ? null : Number(pages),
  };
}

/** Every paragraph of a `.docx` body, as `paragraphsOf` reads them. */
export function paragraphsOfDocx(bytes: Uint8Array): WordParagraph[] {
  return paragraphsOf(documentBody(readDocxPackage(bytes).readText("word/document.xml")));
}

function documentBody(xml: string | undefined): OoxmlElement {
  const root = xml === undefined ? null : parseOoxml(xml);
  const body = root ? findChild(root, "w:body") : undefined;
  if (!body) throw new Error("not a WordprocessingML document: no w:body");
  return body;
}

function pageSetup(body: OoxmlElement): WordPageSetup | null {
  const sectPr = findChild(body, "w:sectPr");
  const size = sectPr && findChild(sectPr, "w:pgSz");
  const margin = sectPr && findChild(sectPr, "w:pgMar");
  if (!size || !margin) return null;
  // A negative top or bottom margin lets text overlap a header; the page is the same size.
  const px = (el: OoxmlElement, name: string) => twipsToPx(Math.abs(Number(el.attrs[name] ?? 0)));
  return {
    width: px(size, "w:w"),
    height: px(size, "w:h"),
    margins: {
      top: px(margin, "w:top"),
      right: px(margin, "w:right"),
      bottom: px(margin, "w:bottom"),
      left: px(margin, "w:left"),
    },
  };
}

/** Layout's zero-width caret sentinel: an empty line's only character. */
export const CARET_SENTINEL = "\u200b";

/** Characters that take no space on the page: whitespace, and the caret sentinel. */
const BLANK = new RegExp(`[\\s${CARET_SENTINEL}]+`, "g");

/**
 * The text a page starts with, in a form both sides can be compared in: blank
 * characters removed, so a tab Word kept and Scrivr turned into a space does
 * not read as a different page start. Sixteen characters tell pages of one
 * document apart, and stop short of where two renderings of the same page
 * would drift apart.
 */
export function pageStartKey(text: string): string {
  return text.replace(BLANK, "").slice(0, 16);
}

export function nonBlankCount(text: string): number {
  return text.replace(BLANK, "").length;
}

/**
 * Where Word started each page after the first. A hard page break at the end
 * of one paragraph and the rendered break Word writes at the start of the next
 * mark one page start, so a break with only blank text since the last one is
 * the same page.
 */
function wordPageStarts(body: OoxmlElement): string[] {
  let text = "";
  const breaks: number[] = [];
  const walk = (el: OoxmlElement): void => {
    for (const node of el.children) {
      if (typeof node === "string" || OUTSIDE_THE_FLOW.has(node.name) || node.name === "mc:Fallback") continue;
      if (node.name === "w:t") text += textContent(node);
      else if (node.name === "w:lastRenderedPageBreak" || (node.name === "w:br" && node.attrs["w:type"] === "page")) {
        const last = breaks.at(-1);
        if (last === undefined || nonBlankCount(text.slice(last)) > 0) breaks.push(text.length);
      } else {
        walk(node);
        if (node.name === "w:p") text += "\n";
      }
    }
  };
  walk(body);
  return breaks.map((at) => pageStartKey(text.slice(at))).filter((key) => key.length > 0);
}

/** Every character of body text, text boxes included. */
function bodyText(body: OoxmlElement): string {
  let text = "";
  const walk = (el: OoxmlElement): void => {
    for (const node of el.children) {
      if (typeof node === "string" || node.name === "mc:Fallback" || node.name === "w:sectPr") continue;
      if (node.name === "w:t") text += textContent(node);
      else walk(node);
    }
  };
  walk(body);
  return text;
}

// ── Paragraph formatting ────────────────────────────────────────────────────

/** A stretch of a paragraph's text and the run properties it is set in. */
export interface Segment {
  text: string;
  rPr: string;
}

export interface WordParagraph {
  /** Its text as Scrivr's `textContent` reads it: a `w:tab` is a tab character. */
  text: string;
  /** The paragraph's visible properties in a canonical form, `""` when it has none. */
  pPr: string;
  /** Its text by visible run properties, adjacent runs with the same ones joined. */
  segments: Segment[];
}

/**
 * The properties a reader can see. Formatting is compared on these alone: a
 * complex-script size, the paragraph mark's own formatting or a proofing
 * language never shows on the page, so losing one is no loss to a reader,
 * and comparing it would fail every paragraph that carries one.
 */
const VISIBLE_PARAGRAPH = new Set([
  "w:pStyle", "w:jc", "w:spacing", "w:contextualSpacing", "w:ind", "w:pBdr", "w:shd", "w:tabs",
  "w:keepNext", "w:keepLines", "w:pageBreakBefore",
]);
const VISIBLE_RUN = new Set([
  "w:rStyle", "w:b", "w:i", "w:u", "w:strike", "w:dstrike", "w:caps", "w:smallCaps",
  "w:sz", "w:color", "w:highlight", "w:shd", "w:rFonts", "w:vertAlign", "w:spacing", "w:position",
]);
/** The faces a Latin run is drawn in; the rest of `w:rFonts` is for other scripts or theme lookups. */
const VISIBLE_FONT_ATTRS = new Set(["w:ascii", "w:hAnsi"]);

function visible(el: OoxmlElement, names: ReadonlySet<string>): string {
  const children = el.children.flatMap((c) => {
    if (typeof c === "string" || !names.has(c.name)) return [];
    if (c.name !== "w:rFonts") return [c];
    // Faces for other scripts only: nothing a Latin reader sees.
    const attrs = Object.fromEntries(Object.entries(c.attrs).filter(([name]) => VISIBLE_FONT_ATTRS.has(name)));
    return Object.keys(attrs).length === 0 ? [] : [{ ...c, attrs }];
  });
  return children.length === 0 ? "" : canonical({ ...el, attrs: {}, children });
}

/**
 * Every paragraph of the body in reading order: those in tables and content
 * controls, and those in text boxes, each after the paragraph it is anchored
 * in. A text box's paragraphs are Word's content as much as the body's are,
 * so one Scrivr drops counts against it.
 */
function paragraphsOf(body: OoxmlElement): WordParagraph[] {
  const out: WordParagraph[] = [];
  const walk = (el: OoxmlElement): void => {
    for (const node of el.children) {
      if (typeof node === "string" || node.name === "mc:Fallback" || node.name === "w:sectPr") continue;
      if (node.name === "w:p") out.push(paragraph(node));
      walk(node);
    }
  };
  walk(body);
  return out;
}

function paragraph(p: OoxmlElement): WordParagraph {
  const pPr = findChild(p, "w:pPr");
  const segments: Segment[] = [];
  const walk = (el: OoxmlElement): void => {
    for (const node of el.children) {
      if (typeof node === "string" || OUTSIDE_THE_FLOW.has(node.name) || node.name === "w:pPr") continue;
      if (node.name !== "w:r") {
        walk(node);
        continue;
      }
      const rPr = findChild(node, "w:rPr");
      let text = "";
      for (const c of node.children) {
        if (typeof c === "string") continue;
        if (c.name === "w:t") text += textContent(c);
        else if (c.name === "w:tab") text += "\t";
      }
      if (text.length === 0) continue;
      const props = rPr ? visible(rPr, VISIBLE_RUN) : "";
      const last = segments.at(-1);
      if (last && last.rPr === props) last.text += text;
      else segments.push({ text, rPr: props });
    }
  };
  walk(p);
  return { text: segments.map((s) => s.text).join(""), pPr: pPr ? visible(pPr, VISIBLE_PARAGRAPH) : "", segments };
}

/** Attributes that change with every save and say nothing about formatting: every `w:rsid*`, and Word 2010's paragraph ids. */
const VOLATILE_ATTR = /^w:rsid|^w14:paraId$|^w14:textId$/;

/**
 * An element as a string that two equal formattings share: attributes sorted
 * and the volatile ones dropped, proofing marks left out. Every element is
 * written open and closed — `<w:b></w:b>` — so an empty one and its
 * self-closing form compare equal.
 */
export function canonical(el: OoxmlElement): string {
  const attrs = Object.keys(el.attrs)
    .filter((name) => !VOLATILE_ATTR.test(name))
    .sort()
    .map((name) => ` ${name}="${el.attrs[name]}"`)
    .join("");
  const children = el.children
    .filter((c): c is OoxmlElement => typeof c !== "string" && c.name !== "w:proofErr")
    .map(canonical)
    .join("");
  return `<${el.name}${attrs}>${children}</${el.name}>`;
}

/**
 * What is not part of a paragraph's own text: shapes and text boxes (which
 * `paragraphsOf` reads as paragraphs of their own), and text Word keeps but
 * does not show.
 */
const OUTSIDE_THE_FLOW = new Set(["mc:AlternateContent", "w:drawing", "w:pict", "w:object", "w:delText", "w:instrText"]);
