export { PdfExport } from "./PdfExport";

/**
 * PDF export — uses the same layout engine as the canvas renderer.
 * Zero fidelity gap: same page breaks, same line positions, same text, same images.
 *
 * Approach:
 *   1. Call editor.layout to get the fully-computed DocumentLayout
 *   2. Walk pages → blocks → lines → spans
 *   3. Draw text spans, inline images, and float images
 *   4. Map each span's CSS font string to a StandardFont (or embedded custom font)
 *   5. Flip Y axis: PDF origin is bottom-left, our layout is top-left
 *
 * Standard PDF fonts are used by default (no embedding) — self-contained output.
 * Pass a `fontResolver` to embed custom fonts via @pdf-lib/fontkit.
 *
 * Font family mapping: serif/Georgia → Times, monospace/Courier → Courier,
 * everything else → Helvetica.
 */
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import {
  computeAlignmentOffset,
  computeJustifySpaceBonus,
  countSpaces,
} from "@scrivr/core";
import type {
  IEditor,
  DocumentLayout,
  LayoutBlock,
  LayoutLine,
  FloatLayout,
} from "@scrivr/core";

/** Constants */

/** 1 CSS pixel = 0.75 PDF points (96dpi → 72dpi) */
const PT_PER_PX = 72 / 96;

/** Public types */

export interface PdfExportOptions {
  /**
   * Called once per unique (family, weight, style) combination found in the
   * document. Return the font file bytes to embed it; return null to fall back
   * to the nearest standard font (Helvetica / Times / Courier).
   *
   * @example
   * fontResolver: (family, weight, style) => fetch(`/fonts/${family}-${weight}.ttf`).then(r => r.arrayBuffer())
   */
  fontResolver?: (
    family: string,
    weight: "normal" | "bold",
    style: "normal" | "italic",
  ) => Promise<ArrayBuffer | null>;
}

/** Public API */

/**
 * Export the editor's current document to a PDF binary.
 *
 * @example
 * const bytes = await exportToPdf(editor);
 * const blob  = new Blob([bytes], { type: "application/pdf" });
 * window.open(URL.createObjectURL(blob));
 */
export async function exportToPdf(
  editor: IEditor,
  options?: PdfExportOptions,
): Promise<Uint8Array> {
  return buildPdf(editor.layout, options);
}

/**
 * Lower-level export — accepts a pre-computed DocumentLayout directly.
 * Useful for server-side rendering or testing.
 */
export async function buildPdf(
  layout: DocumentLayout,
  options?: PdfExportOptions,
): Promise<Uint8Array> {
  const { pageConfig } = layout;
  const pageWidthPt = pageConfig.pageWidth * PT_PER_PX;
  const pageHeightPt = pageConfig.pageHeight * PT_PER_PX;

  const pdfDoc = await PDFDocument.create();

  // Register fontkit when custom font resolver is provided.
  if (options?.fontResolver) {
    pdfDoc.registerFontkit(fontkit);
  }

  // Pre-embed all 12 standard font variants once (pdf-lib caches by reference).
  const standardFonts = await embedStandardFonts(pdfDoc);

  // Embed custom fonts if fontResolver provided — keyed by "family:weight:style".
  const customFonts = options?.fontResolver
    ? await embedCustomFonts(pdfDoc, layout, options.fontResolver)
    : new Map<string, PDFFont>();

  // Fetch and embed all images referenced in the document (parallel).
  const imageCache = await embedImages(pdfDoc, layout);

  for (let i = 0; i < layout.pages.length; i++) {
    const layoutPage = layout.pages[i]!;
    const pageNumber = i + 1; // FloatLayout.page is 1-based
    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

    const pageFloats = (layout.floats ?? []).filter(
      (f) => f.page === pageNumber,
    );

    // 'behind' floats drawn BEFORE blocks so text renders on top.
    for (const float of pageFloats) {
      if (float.mode === "behind") {
        drawPdfFloat(page, float, pageHeightPt, imageCache);
      }
    }

    for (const block of layoutPage.blocks) {
      drawBlock(page, block, pageHeightPt, standardFonts, customFonts, imageCache);
    }

    // All other float modes drawn AFTER blocks (front, square-*, top-bottom).
    for (const float of pageFloats) {
      if (float.mode !== "behind") {
        drawPdfFloat(page, float, pageHeightPt, imageCache);
      }
    }
  }

  return pdfDoc.save();
}

/** Image helpers */

/** Fetch image bytes and detect format from a URL or data URI. */
async function fetchImageBytes(
  src: string,
): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> {
  try {
    if (src.startsWith("data:")) {
      // data:image/png;base64,<data>
      const [header, b64] = src.split(",") as [string, string];
      const format: "png" | "jpeg" = header.includes("png") ? "png" : "jpeg";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { bytes, format };
    }

    const res = await fetch(src);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Detect from magic bytes: PNG = 89 50 4E 47, JPEG = FF D8 FF
    const format: "png" | "jpeg" =
      bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpeg";
    return { bytes, format };
  } catch {
    return null;
  }
}

/**
 * Scan the layout for all image srcs, fetch them in parallel, and embed
 * into the PDFDocument. Returns a Map<src → PDFImage | null>.
 */
async function embedImages(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
): Promise<Map<string, PDFImage | null>> {
  const srcs = new Set<string>();

  // Collect from floats.
  for (const float of layout.floats ?? []) {
    const src = float.node.attrs["src"] as string | undefined;
    if (src) srcs.add(src);
  }

  // Collect from inline object spans in all blocks.
  for (const page of layout.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind === "object" && span.node.type.name === "image") {
            const src = span.node.attrs["src"] as string | undefined;
            if (src) srcs.add(src);
          }
        }
      }
    }
  }

  const result = new Map<string, PDFImage | null>();

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      const fetched = await fetchImageBytes(src);
      if (!fetched) {
        result.set(src, null);
        return;
      }
      try {
        const image =
          fetched.format === "png"
            ? await pdfDoc.embedPng(fetched.bytes)
            : await pdfDoc.embedJpg(fetched.bytes);
        result.set(src, image);
      } catch {
        result.set(src, null);
      }
    }),
  );

  return result;
}

/** Draw a float image (or a gray placeholder if unavailable) onto a PDF page. */
function drawPdfFloat(
  page: PDFPage,
  float: FloatLayout,
  pageHeightPt: number,
  imageCache: Map<string, PDFImage | null>,
): void {
  const src = float.node.attrs["src"] as string | undefined;
  const x = float.x * PT_PER_PX;
  const y = flipY(float.y + float.height, pageHeightPt);
  const w = float.width * PT_PER_PX;
  const h = float.height * PT_PER_PX;

  if (src) {
    const image = imageCache.get(src);
    if (image) {
      page.drawImage(image, { x, y, width: w, height: h });
      return;
    }
  }

  // Placeholder for missing/failed images.
  drawImagePlaceholder(page, x, y, w, h);
}

/** Inlined from TextBlockStrategy — pure math, no core dep needed. */
function computeObjectRenderY(
  lineY: number,
  line: LayoutLine,
  span: { kind: "object"; height: number; verticalAlign: string },
): number {
  const baseline = lineY + line.ascent;
  switch (span.verticalAlign) {
    case "top":      return lineY;
    case "bottom":   return lineY + line.lineHeight - span.height;
    case "middle":
      return line.xHeight > 0
        ? baseline - line.xHeight / 2 - span.height / 2
        : lineY + Math.max(0, line.lineHeight - span.height) / 2;
    case "text-top":    return baseline - line.textAscent;
    case "text-bottom": return baseline + line.descent - span.height;
    default:            return baseline - span.height; // "baseline"
  }
}

function drawImagePlaceholder(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: rgb(0.88, 0.91, 0.94),
    borderWidth: 1,
    color: rgb(0.95, 0.96, 0.98),
  });
}

/** Block / line / span rendering */

function drawBlock(
  page: PDFPage,
  block: LayoutBlock,
  pageHeightPt: number,
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
  imageCache: Map<string, PDFImage | null>,
): void {
  // Horizontal rule — leaf block with no lines.
  if (block.node.type.name === "horizontalRule") {
    const midY = block.y + block.height / 2;
    const x1 = block.x * PT_PER_PX;
    const x2 = (block.x + block.availableWidth) * PT_PER_PX;
    const y = flipY(midY, pageHeightPt);
    page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: 1.5 * PT_PER_PX,
      color: rgb(0.796, 0.835, 0.882), // #cbd5e1
    });
    return;
  }

  // Draw list marker if present.
  const firstLine = block.lines[0];
  if (block.listMarker && block.listMarkerX !== undefined && firstLine) {
    const markerFont = standardFonts["normal"]!;
    const firstSpan = firstLine.spans[0];
    const fontSize = extractFontSizePx(
      (firstSpan?.kind === "text" ? firstSpan.font : undefined) ??
        "12px sans-serif",
    );
    page.drawText(block.listMarker, {
      x: block.listMarkerX * PT_PER_PX,
      y: flipY(block.y + firstLine.ascent, pageHeightPt),
      size: fontSize * PT_PER_PX,
      font: markerFont,
      color: rgb(0, 0, 0),
    });
  }

  let lineY = block.y;
  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    drawLine(page, line, block, lineY, li, pageHeightPt, standardFonts, customFonts, imageCache);
    lineY += line.lineHeight;
  }
}

function drawLine(
  page: PDFPage,
  line: LayoutLine,
  block: LayoutBlock,
  lineY: number,
  lineIndex: number,
  pageHeightPt: number,
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
  imageCache: Map<string, PDFImage | null>,
): void {
  const isLastLineOfBlock = lineIndex === block.lines.length - 1 && !block.continuesOnNextPage;
  const lineConstraintX = line.constraintX ?? 0;
  const effectiveWidth = line.effectiveWidth ?? block.availableWidth;
  const lineOffsetX = lineConstraintX + computeAlignmentOffset(block.align, effectiveWidth, line.width);
  const spaceBonus = computeJustifySpaceBonus(block.align, line.spans, effectiveWidth, line.width, isLastLineOfBlock);
  const baselineY = lineY + line.ascent;
  const pdfBaseline = flipY(baselineY, pageHeightPt);

  let spacesBeforeSpan = 0;
  for (const span of line.spans) {
    const spanAbsX = block.x + lineOffsetX + span.x + spacesBeforeSpan * spaceBonus;

    if (span.kind === "object") {
      if (span.node.type.name !== "image" || span.width <= 0 || span.height <= 0) continue;
      const src = span.node.attrs["src"] as string | undefined;
      const image = src ? imageCache.get(src) : null;
      const objX = spanAbsX * PT_PER_PX;
      const objY = computeObjectRenderY(lineY, line, span);
      const pdfY = flipY(objY + span.height, pageHeightPt);
      const w = span.width * PT_PER_PX;
      const h = span.height * PT_PER_PX;
      if (image) {
        page.drawImage(image, { x: objX, y: pdfY, width: w, height: h });
      } else {
        drawImagePlaceholder(page, objX, pdfY, w, h);
      }
      continue;
    }

    if (span.kind !== "text") continue;

    const text = sanitizeForWinAnsi(span.text);
    if (!text) {
      spacesBeforeSpan += countSpaces(span.text);
      continue;
    }

    const fontSize = extractFontSizePx(span.font);
    const font = resolveFont(span.font, standardFonts, customFonts);
    const color = extractColor(span.marks);

    page.drawText(text, {
      x: spanAbsX * PT_PER_PX,
      y: pdfBaseline,
      size: fontSize * PT_PER_PX,
      font,
      color,
    });

    drawDecorations(page, span, spanAbsX, baselineY, pageHeightPt);

    spacesBeforeSpan += countSpaces(span.text);
  }
}

function drawDecorations(
  page: PDFPage,
  span: {
    font: string;
    width: number;
    marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
  },
  spanAbsX: number,
  baselineY: number,
  pageHeightPt: number,
): void {
  if (!span.marks) return;

  const fontSize = extractFontSizePx(span.font);
  const thickness = Math.max(1, fontSize * 0.06) * PT_PER_PX;
  const x1 = spanAbsX * PT_PER_PX;
  const x2 = x1 + span.width * PT_PER_PX;

  for (const mark of span.marks) {
    if (mark.name === "underline" || mark.name === "link") {
      const lineColor =
        mark.name === "link" ? rgb(0.15, 0.39, 0.92) : rgb(0, 0, 0);
      page.drawLine({
        start: { x: x1, y: flipY(baselineY + fontSize * 0.15, pageHeightPt) },
        end: { x: x2, y: flipY(baselineY + fontSize * 0.15, pageHeightPt) },
        thickness,
        color: lineColor,
      });
    }
    if (mark.name === "strikethrough") {
      page.drawLine({
        start: { x: x1, y: flipY(baselineY - fontSize * 0.3, pageHeightPt) },
        end: { x: x2, y: flipY(baselineY - fontSize * 0.3, pageHeightPt) },
        thickness,
        color: rgb(0, 0, 0),
      });
    }
    if (mark.name === "highlight") {
      const highlightColor = parseHexColor(
        typeof mark.attrs["color"] === "string"
          ? mark.attrs["color"]
          : "#fef08a",
      );
      page.drawRectangle({
        x: x1,
        y: flipY(baselineY + fontSize * 0.2, pageHeightPt),
        width: span.width * PT_PER_PX,
        height: fontSize * 1.1 * PT_PER_PX,
        color: highlightColor,
        opacity: 0.4,
      });
    }
  }
}

// ── Font resolution ───────────────────────────────────────────────────────────

type FontVariant = "normal" | "bold" | "italic" | "boldItalic";
type FontFamily = "serif" | "sans" | "mono";
type FontCache = Record<string, PDFFont>; // key: "sans_bold" etc.

async function embedStandardFonts(pdfDoc: PDFDocument): Promise<FontCache> {
  const [
    timesRoman,
    timesBold,
    timesItalic,
    timesBoldItalic,
    helvetica,
    helveticaBold,
    helveticaOblique,
    helveticaBoldOblique,
    courier,
    courierBold,
    courierOblique,
    courierBoldOblique,
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
    normal: helvetica,
    serif_normal: timesRoman,
    serif_bold: timesBold,
    serif_italic: timesItalic,
    serif_boldItalic: timesBoldItalic,
    sans_normal: helvetica,
    sans_bold: helveticaBold,
    sans_italic: helveticaOblique,
    sans_boldItalic: helveticaBoldOblique,
    mono_normal: courier,
    mono_bold: courierBold,
    mono_italic: courierOblique,
    mono_boldItalic: courierBoldOblique,
  };
}

/**
 * Walk the layout, collect all unique (family, weight, style) combos, call
 * fontResolver for each, and embed those that return bytes.
 *
 * Custom font map key format: "FamilyName:bold:italic" (e.g. "Inter:bold:normal").
 */
async function embedCustomFonts(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
  fontResolver: NonNullable<PdfExportOptions["fontResolver"]>,
): Promise<Map<string, PDFFont>> {
  // Collect unique (family, weight, style) combinations.
  const combos = new Map<string, { family: string; weight: "normal" | "bold"; style: "normal" | "italic" }>();

  const visitFont = (cssFont: string) => {
    const family = extractCssFamilyName(cssFont);
    if (!family) return;
    const lower = cssFont.toLowerCase();
    const weight: "normal" | "bold" = /bold|[789]\d\d/.test(lower) ? "bold" : "normal";
    const style: "normal" | "italic" = /italic|oblique/.test(lower) ? "italic" : "normal";
    const key = `${family}:${weight}:${style}`;
    if (!combos.has(key)) combos.set(key, { family, weight, style });
  };

  for (const page of layout.pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind === "text") visitFont(span.font);
        }
      }
    }
  }

  const result = new Map<string, PDFFont>();

  await Promise.all(
    Array.from(combos.entries()).map(async ([key, { family, weight, style }]) => {
      try {
        const bytes = await fontResolver(family, weight, style);
        if (!bytes) return;
        const font = await pdfDoc.embedFont(new Uint8Array(bytes));
        result.set(key, font);
      } catch {
        // Fall back to standard font for this combo.
      }
    }),
  );

  return result;
}

function resolveFont(
  cssFont: string,
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
): PDFFont {
  const lower = cssFont.toLowerCase();
  const isBold = /bold|[789]\d\d/.test(lower);
  const isItalic = /italic|oblique/.test(lower);

  // Check custom fonts first.
  if (customFonts.size > 0) {
    const family = extractCssFamilyName(cssFont);
    const weight: "normal" | "bold" = isBold ? "bold" : "normal";
    const style: "normal" | "italic" = isItalic ? "italic" : "normal";
    const custom = customFonts.get(`${family}:${weight}:${style}`);
    if (custom) return custom;
  }

  // Fall back to standard fonts.
  let stdFamily: FontFamily = "sans";
  if (/georgia|times|serif/.test(lower) && !/sans-serif/.test(lower))
    stdFamily = "serif";
  else if (/courier|mono|code/.test(lower)) stdFamily = "mono";

  const variant: FontVariant =
    isBold && isItalic
      ? "boldItalic"
      : isBold
        ? "bold"
        : isItalic
          ? "italic"
          : "normal";

  return standardFonts[`${stdFamily}_${variant}`] ?? standardFonts["normal"]!;
}

/** Helpers */

/**
 * Extract the first font family name from a CSS font shorthand string.
 * "bold italic 14px Inter, sans-serif" → "Inter"
 */
function extractCssFamilyName(cssFont: string): string {
  const sizeMatch = cssFont.match(/\d+(?:\.\d+)?px\s+(.*)/i);
  if (!sizeMatch?.[1]) return "";
  const first = sizeMatch[1].split(",")[0]?.trim().replace(/['"]/g, "") ?? "";
  // Drop generic family keywords.
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(first))
    return "";
  return first;
}

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
    .replace(/[^\u0020-\u00ff\u0100-\u02dc]/g, "?"); // replace out-of-range with ?
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

/** Extract the text fill color from marks. */
function extractColor(
  marks?: Array<{ name: string; attrs: Record<string, unknown> }>,
): ReturnType<typeof rgb> {
  const colorMark = marks?.find((m) => m.name === "color");
  const colorVal = colorMark?.attrs["color"];
  if (typeof colorVal === "string") return parseHexColor(colorVal);
  if (marks?.some((m) => m.name === "link")) return rgb(0.15, 0.39, 0.92);
  return rgb(0, 0, 0);
}

/** Parse "#rrggbb" or "#rgb" → pdf-lib rgb(). Falls back to black on failure. */
function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const [a, b, c] = clean.split("") as [string, string, string];
    return rgb(
      parseInt(a + a, 16) / 255,
      parseInt(b + b, 16) / 255,
      parseInt(c + c, 16) / 255,
    );
  }
  if (clean.length === 6) {
    return rgb(
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
    );
  }
  return rgb(0, 0, 0);
}

