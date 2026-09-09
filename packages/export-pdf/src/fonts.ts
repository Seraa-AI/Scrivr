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
import type { DocumentLayout } from "@scrivr/core";
import type { PdfFontRegistry } from "./context";

export type FontVariant = "normal" | "bold" | "italic" | "boldItalic";
export type FontFamily = "serif" | "sans" | "mono";

/** A font the document named that the exporter could not embed. */
export interface FontSubstitution {
  family: string;
  weight: "normal" | "bold";
  style: "normal" | "italic";
  /** The standard font drawn in its place. */
  substitute: FontFamily;
}
export type FontCache = Record<string, PDFFont>;

export interface PdfExportFontOptions {
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

/** A distinct font the document asks for by name. */
export interface FontCombo {
  family: string;
  weight: "normal" | "bold";
  style: "normal" | "italic";
  /** A CSS font string that produced this combo, kept for its generic hint. */
  cssFont: string;
}

/**
 * Every uniquely named (family, weight, style) the layout asks for, keyed as
 * `family:weight:style`. Spans naming only a generic family are skipped —
 * nothing was requested, so nothing can be substituted for it.
 */
export function collectFontCombos(layout: DocumentLayout): Map<string, FontCombo> {
  const combos = new Map<string, FontCombo>();

  const visitFont = (cssFont: string) => {
    const family = extractCssFamilyName(cssFont);
    if (!family) return;
    const lower = cssFont.toLowerCase();
    const weight: "normal" | "bold" = /bold|[789]\d\d/.test(lower) ? "bold" : "normal";
    const style: "normal" | "italic" = /italic|oblique/.test(lower) ? "italic" : "normal";
    const key = `${family}:${weight}:${style}`;
    if (!combos.has(key)) combos.set(key, { family, weight, style, cssFont });
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

  return combos;
}

/**
 * Call fontResolver for each requested combo and embed those that return bytes.
 * Combos absent from the result are the ones that will be substituted.
 */
export async function embedCustomFonts(
  pdfDoc: PDFDocument,
  combos: Map<string, FontCombo>,
  fontResolver: NonNullable<PdfExportFontOptions["fontResolver"]>,
): Promise<Map<string, PDFFont>> {
  pdfDoc.registerFontkit(fontkit);

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
 * The standard font a named family falls back to when nothing was embedded for
 * it. Read by both `resolveFont` and substitution reporting so the PDF and the
 * report can never disagree about what was actually used.
 */
export function standardFamilyFor(cssFont: string): FontFamily {
  const lower = cssFont.toLowerCase();
  if (/georgia|times|serif/.test(lower) && !/sans-serif/.test(lower)) return "serif";
  if (/courier|mono|code/.test(lower)) return "mono";
  return "sans";
}

/** Resolve a CSS font string to the best available PDFFont. */
export function resolveFont(
  cssFont: string,
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
): PDFFont {
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

  const stdFamily = standardFamilyFor(cssFont);

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

/** Create a PdfFontRegistry from standard + custom font caches. */
export function createFontRegistry(
  standardFonts: FontCache,
  customFonts: Map<string, PDFFont>,
): PdfFontRegistry {
  const embedded = new Set(customFonts.values());
  return {
    resolve: (cssFont: string) => resolveFont(cssFont, standardFonts, customFonts),
    isUnicode: (font: PDFFont) => embedded.has(font),
    fallback: standardFonts["normal"]!,
  };
}
