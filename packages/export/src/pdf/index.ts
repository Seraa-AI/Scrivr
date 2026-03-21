export { PdfExport } from "./PdfExport";

/**
 * PDF export — uses the same layout engine as the canvas renderer.
 * Zero fidelity gap: same page breaks, same line positions, same text.
 *
 * Approach:
 *   1. Call editor.layout to get the fully-computed DocumentLayout
 *   2. Walk pages → blocks → lines → spans
 *   3. Map each span's CSS font string to a pdf-lib StandardFont
 *   4. Draw text at the exact pixel position, scaled px→pt (×0.75)
 *   5. Flip Y axis: PDF origin is bottom-left, our layout is top-left
 *
 * Standard PDF fonts are used (no embedding) so the output is self-contained.
 * Font family mapping: serif/Georgia → Times, monospace/Courier → Courier,
 * everything else → Helvetica.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { IEditor, DocumentLayout, LayoutBlock, LayoutLine } from "@inscribe/core";

// ── Constants ─────────────────────────────────────────────────────────────────

/** 1 CSS pixel = 0.75 PDF points (96dpi → 72dpi) */
const PT_PER_PX = 72 / 96;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Export the editor's current document to a PDF binary.
 *
 * @example
 * const bytes = await exportToPdf(editor);
 * const blob  = new Blob([bytes], { type: "application/pdf" });
 * const url   = URL.createObjectURL(blob);
 * window.open(url);
 */
export async function exportToPdf(editor: IEditor): Promise<Uint8Array> {
  return buildPdf(editor.layout);
}

/**
 * Lower-level export — accepts a pre-computed DocumentLayout directly.
 * Useful for server-side rendering or testing.
 */
export async function buildPdf(layout: DocumentLayout): Promise<Uint8Array> {
  const { pageConfig } = layout;
  const pageWidthPt  = pageConfig.pageWidth  * PT_PER_PX;
  const pageHeightPt = pageConfig.pageHeight * PT_PER_PX;

  const pdfDoc = await PDFDocument.create();

  // Pre-embed all 12 standard font variants once (pdf-lib caches by reference)
  const fonts = await embedStandardFonts(pdfDoc);

  for (const layoutPage of layout.pages) {
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

    for (const block of layoutPage.blocks) {
      drawBlock(page, block, pageHeightPt, fonts);
    }
  }

  return pdfDoc.save();
}

// ── Block / line / span rendering ─────────────────────────────────────────────

function drawBlock(
  page: PDFPage,
  block: LayoutBlock,
  pageHeightPt: number,
  fonts: FontCache,
): void {
  // Draw list marker if present
  const firstLine = block.lines[0];
  if (block.listMarker && block.listMarkerX !== undefined && firstLine !== undefined) {
    const markerFont = fonts["normal"]!;
    const fontSize   = extractFontSizePx(firstLine.spans[0]?.font ?? "12px sans-serif");
    const markerX    = block.listMarkerX * PT_PER_PX;
    const markerY    = flipY(block.y + firstLine.ascent, pageHeightPt);
    page.drawText(block.listMarker, {
      x: markerX,
      y: markerY,
      size: fontSize * PT_PER_PX,
      font: markerFont,
      color: rgb(0, 0, 0),
    });
  }

  let lineY = block.y;

  for (const line of block.lines) {
    drawLine(page, line, block, lineY, pageHeightPt, fonts);
    lineY += line.lineHeight;
  }
}

function drawLine(
  page: PDFPage,
  line: LayoutLine,
  block: LayoutBlock,
  lineY: number,
  pageHeightPt: number,
  fonts: FontCache,
): void {
  // Alignment offset (same logic as PageRenderer)
  const alignOffset = computeAlignOffset(block.align, line.width, block.availableWidth);

  // Baseline y (PDF origin bottom-left)
  const baselineY = lineY + line.ascent;
  const pdfY = flipY(baselineY, pageHeightPt);

  for (const span of line.spans) {
    // Strip zero-width and non-WinAnsi characters — Standard PDF fonts use
    // WinAnsi encoding (roughly Latin-1 + Windows-1252 extras up to U+02DC).
    // U+200B (zero-width space) is the most common offender: the layout engine
    // inserts it as a placeholder for empty paragraphs.
    const text = sanitizeForWinAnsi(span.text);
    if (!text) continue;

    const fontSize = extractFontSizePx(span.font);
    const font     = resolveFont(span.font, fonts);
    const color    = extractColor(span.marks);

    const pdfX = (block.x + span.x + alignOffset) * PT_PER_PX;
    const sizePt = fontSize * PT_PER_PX;

    page.drawText(text, {
      x:    pdfX,
      y:    pdfY,
      size: sizePt,
      font,
      color,
    });

    // Post-text decorations (underline, strikethrough)
    drawDecorations(page, span, block.x + span.x + alignOffset, baselineY, pageHeightPt, fonts);
  }
}

function drawDecorations(
  page: PDFPage,
  span: { font: string; width: number; marks?: Array<{ name: string; attrs: Record<string, unknown> }> },
  spanAbsX: number,
  baselineY: number,
  pageHeightPt: number,
  _fonts: FontCache,
): void {
  if (!span.marks) return;

  const fontSize  = extractFontSizePx(span.font);
  const thickness = Math.max(1, fontSize * 0.06) * PT_PER_PX;
  const x1 = spanAbsX * PT_PER_PX;
  const x2 = x1 + span.width * PT_PER_PX;

  for (const mark of span.marks) {
    if (mark.name === "underline" || mark.name === "link") {
      const lineColor = mark.name === "link" ? rgb(0.15, 0.39, 0.92) : rgb(0, 0, 0);
      const lineY = flipY(baselineY + fontSize * 0.15, pageHeightPt);
      page.drawLine({
        start: { x: x1, y: lineY },
        end:   { x: x2, y: lineY },
        thickness,
        color: lineColor,
      });
    }
    if (mark.name === "strikethrough") {
      const lineY = flipY(baselineY - fontSize * 0.3, pageHeightPt);
      page.drawLine({
        start: { x: x1, y: lineY },
        end:   { x: x2, y: lineY },
        thickness,
        color: rgb(0, 0, 0),
      });
    }
    if (mark.name === "highlight") {
      const highlightColor = parseHexColor(typeof mark.attrs.color === "string" ? mark.attrs.color : "#fef08a");
      const rectY  = flipY(baselineY + fontSize * 0.2, pageHeightPt);
      const height = fontSize * 1.1 * PT_PER_PX;
      page.drawRectangle({
        x: x1,
        y: rectY,
        width:  span.width * PT_PER_PX,
        height,
        color:  highlightColor,
        opacity: 0.4,
      });
    }
  }
}

// ── Font resolution ───────────────────────────────────────────────────────────

type FontVariant = "normal" | "bold" | "italic" | "boldItalic";
type FontFamily  = "serif" | "sans" | "mono";
type FontCache   = Record<string, PDFFont>; // key: "serif_bold" etc.

async function embedStandardFonts(pdfDoc: PDFDocument): Promise<FontCache> {
  const [
    timesRoman, timesBold, timesItalic, timesBoldItalic,
    helvetica,  helveticaBold, helveticaOblique, helveticaBoldOblique,
    courier,    courierBold,   courierOblique,   courierBoldOblique,
  ] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.TimesRoman),
    pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
    pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    pdfDoc.embedFont(StandardFonts.Courier),
    pdfDoc.embedFont(StandardFonts.CourierBold),
    pdfDoc.embedFont(StandardFonts.CourierOblique),
    pdfDoc.embedFont(StandardFonts.CourierBoldOblique),
  ]);

  return {
    normal:           helvetica,
    serif_normal:     timesRoman,
    serif_bold:       timesBold,
    serif_italic:     timesItalic,
    serif_boldItalic: timesBoldItalic,
    sans_normal:      helvetica,
    sans_bold:        helveticaBold,
    sans_italic:      helveticaOblique,
    sans_boldItalic:  helveticaBoldOblique,
    mono_normal:      courier,
    mono_bold:        courierBold,
    mono_italic:      courierOblique,
    mono_boldItalic:  courierBoldOblique,
  };
}

function resolveFont(cssFont: string, fonts: FontCache): PDFFont {
  const lower   = cssFont.toLowerCase();
  const isBold   = /bold|[789]\d\d/.test(lower);
  const isItalic = /italic|oblique/.test(lower);

  let family: FontFamily = "sans";
  if (/georgia|times|serif/.test(lower) && !/sans-serif/.test(lower)) family = "serif";
  else if (/courier|mono|code/.test(lower)) family = "mono";

  const variant: FontVariant = isBold && isItalic ? "boldItalic"
    : isBold   ? "bold"
    : isItalic ? "italic"
    : "normal";

  return fonts[`${family}_${variant}`] ?? fonts["normal"]!;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Remove characters that WinAnsi (Standard PDF font encoding) cannot represent.
 *
 * WinAnsi covers roughly U+0020–U+00FF plus a handful of extras in U+0100–U+02DC
 * (smart quotes, em-dash, etc.). Everything else — including zero-width spaces,
 * emoji, CJK — must be stripped or substituted, otherwise pdf-lib throws.
 *
 * Common offenders from the layout engine:
 *   U+200B zero-width space  — empty-paragraph placeholder
 *   U+FEFF BOM               — occasionally injected by paste
 */
function sanitizeForWinAnsi(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\u00ad\ufeff]/g, "") // zero-width / invisible
    .replace(/[^\u0020-\u00ff\u0100-\u02dc]/g, "?");  // replace true out-of-range with ?
}

/** Flip from top-left (our layout) to bottom-left (PDF) coordinate space. */
function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}

/** Parse "bold italic 14px Georgia" → 14 */
function extractFontSizePx(cssFont: string): number {
  const match = cssFont.match(/(\d+(?:\.\d+)?)px/);
  return match?.[1] !== undefined ? parseFloat(match[1]) : 12;
}

/** Extract the text fill color from marks (color mark wins, link = blue, else black). */
function extractColor(marks?: Array<{ name: string; attrs: Record<string, unknown> }>): ReturnType<typeof rgb> {
  const colorMark = marks?.find((m) => m.name === "color");
  const colorVal = colorMark?.attrs.color;
  if (typeof colorVal === "string") return parseHexColor(colorVal);
  if (marks?.some((m) => m.name === "link")) return rgb(0.15, 0.39, 0.92); // #2563eb
  return rgb(0, 0, 0);
}

/** Parse "#rrggbb" or "#rgb" → pdf-lib rgb(). Falls back to black on failure. */
function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const chars = clean.split("");
    const r = parseInt((chars[0] ?? "0") + (chars[0] ?? "0"), 16) / 255;
    const g = parseInt((chars[1] ?? "0") + (chars[1] ?? "0"), 16) / 255;
    const b = parseInt((chars[2] ?? "0") + (chars[2] ?? "0"), 16) / 255;
    return rgb(r, g, b);
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(0, 0, 0);
}

/** Compute x offset for text alignment. Matches PageRenderer logic. */
function computeAlignOffset(
  align: "left" | "center" | "right" | "justify",
  lineWidth: number,
  availableWidth: number,
): number {
  if (align === "center") return (availableWidth - lineWidth) / 2;
  if (align === "right")  return availableWidth - lineWidth;
  return 0; // left + justify: no offset
}
