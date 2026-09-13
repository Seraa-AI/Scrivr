/**
 * Font resolution and embedding for PDF export.
 * Extracted from the monolithic exporter to support the handler dispatch pattern.
 */

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  type PDFFont,
} from "pdf-lib";
import type { DocumentLayout, FontResolutionId, FontResource } from "@scrivr/core";
import type { PdfFontRegistry } from "./context";

export type FontVariant = "normal" | "bold" | "italic" | "boldItalic";
export type FontFamily = "serif" | "sans" | "mono";
export type FontCache = Record<string, PDFFont>;

export interface PdfExportFontOptions {
  /**
   * @deprecated Supply the editor a `FontProvider` instead. This resolves bytes
   * by family name at export time, so it can embed a face the layout never
   * measured — the mismatch the provider exists to remove. Still honoured, and
   * still consulted after the layout's own resolutions.
   */
  fontResolver?: (
    family: string,
    weight: "normal" | "bold",
    style: "normal" | "italic",
  ) => Promise<ArrayBuffer | null>;
}

export async function embedStandardFonts(pdfDoc: PDFDocument): Promise<FontCache> {
  const [
    timesRoman, timesBold, timesItalic, timesBoldItalic,
    helvetica, helveticaBold, helveticaOblique, helveticaBoldOblique,
    courier, courierBold, courierOblique, courierBoldOblique,
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
 * Extract the first font family name from a CSS font shorthand string.
 * "bold italic 14px Inter, sans-serif" → "Inter"
 */
export function extractCssFamilyName(cssFont: string): string {
  const sizeMatch = cssFont.match(/\d+(?:\.\d+)?px\s+(.*)/i);
  if (!sizeMatch?.[1]) return "";
  const first = sizeMatch[1].split(",")[0]?.trim().replace(/['"]/g, "") ?? "";
  if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(first))
    return "";
  return first;
}

/**
 * Walk the layout, collect all unique (family, weight, style) combos, call
 * fontResolver for each, and embed those that return bytes.
 */
export async function embedCustomFonts(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
  fontResolver: NonNullable<PdfExportFontOptions["fontResolver"]>,
): Promise<Map<string, PDFFont>> {
  pdfDoc.registerFontkit(fontkit);

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

/**
 * Embed the faces the layout actually measured against.
 *
 * The layout resolved every span to a face and recorded which one; this walks
 * that table rather than the family names, so the PDF paints the same
 * typeface the geometry was computed from. Deriving a font from the name a
 * second time is what let a document measured in one face be painted in
 * another at those coordinates.
 *
 * A resource whose licence forbids embedding is skipped: its spans fall back
 * to a standard font, which is visibly wrong but lawfully so.
 */
export async function embedResolvedFonts(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
): Promise<Map<FontResolutionId, PDFFont>> {
  const embedded = new Map<FontResolutionId, PDFFont>();
  const resolutions = layout.fontResolutions;
  if (!resolutions?.size) return embedded;

  pdfDoc.registerFontkit(fontkit);

  // Many ids can name one resource — the same face answering requests for a
  // weight nobody supplied. Embed the bytes once and point all of them at it.
  const byResource = new Map<string, { resource: FontResource; ids: FontResolutionId[] }>();
  for (const [id, resolution] of resolutions) {
    const { resource } = resolution;
    if (!resource || resource.embedding?.allowed === false) continue;
    const group = byResource.get(resource.id) ?? { resource, ids: [] };
    group.ids.push(id);
    byResource.set(resource.id, group);
  }

  await Promise.all(
    [...byResource.values()].map(async ({ resource, ids }) => {
      try {
        const font = await pdfDoc.embedFont(new Uint8Array(await resource.bytes()));
        for (const id of ids) embedded.set(id, font);
      } catch {
        // Bytes that will not embed are not a reason to lose the export. These
        // spans fall through to a standard font.
      }
    }),
  );

  return embedded;
}

/**
 * Pick the PDFFont for a span.
 *
 * Preference order is by how much each source knows. The layout's resolution
 * names the face the geometry was measured from, so it wins. `fontResolver`
 * is the caller's own answer, keyed by family. The standard fonts are a guess
 * from the family name, and the only option left when nobody resolved
 * anything.
 */
export function resolveFont(
  cssFont: string,
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
  resolvedFonts?: Map<FontResolutionId, PDFFont>,
  resolution?: FontResolutionId,
): PDFFont {
  if (resolution !== undefined) {
    const measured = resolvedFonts?.get(resolution);
    if (measured) return measured;
  }

  const lower = cssFont.toLowerCase();
  const isBold = /bold|[789]\d\d/.test(lower);
  const isItalic = /italic|oblique/.test(lower);

  if (customFonts.size > 0) {
    const family = extractCssFamilyName(cssFont);
    const weight: "normal" | "bold" = isBold ? "bold" : "normal";
    const style: "normal" | "italic" = isItalic ? "italic" : "normal";
    const custom = customFonts.get(`${family}:${weight}:${style}`);
    if (custom) return custom;
  }

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

/** Create a PdfFontRegistry from the layout's resolutions plus the font caches. */
export function createFontRegistry(
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
  resolvedFonts: Map<FontResolutionId, PDFFont> = new Map(),
): PdfFontRegistry {
  const embedded = new Set([...customFonts.values(), ...resolvedFonts.values()]);
  return {
    resolve: (cssFont, resolution) =>
      resolveFont(cssFont, standardFonts, customFonts, resolvedFonts, resolution),
    isUnicode: (font: PDFFont) => embedded.has(font),
    fallback: standardFonts["normal"]!,
  };
}
