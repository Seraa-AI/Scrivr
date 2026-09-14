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
 * Embed the faces the layout actually measured against.
 *
 * The layout resolved every span to a face and recorded which one; this walks
 * that table rather than the family names, so the PDF paints the same
 * typeface the geometry was computed from. Deriving a font from the name a
 * second time is what let a document measured in one face be painted in
 * another at those coordinates.
 *
 * Licence and parse policy live in `embedFaces`, so both export paths apply
 * the same one.
 */
/**
 * Embed one set of faces, keyed by the id that identifies them.
 *
 * The single place bytes become a `PDFFont`, so both export paths agree on
 * what may go in a file and what happens when it will not parse. A face whose
 * licence forbids embedding is skipped — it must not travel inside the
 * document — and its spans fall back to a standard font, which is visibly
 * wrong but lawfully so. Bytes that will not parse are an error: switching
 * silently to a standard font would leave every glyph at coordinates measured
 * from a different typeface, which is the defect this lane exists to remove.
 */
export async function embedFaces(
  pdfDoc: PDFDocument,
  resources: Iterable<FontResource>,
): Promise<Map<string, PDFFont>> {
  const wanted = new Map<string, FontResource>();
  for (const resource of resources) {
    if (resource.embedding?.allowed === false) continue;
    wanted.set(resource.id, resource);
  }

  const embedded = new Map<string, PDFFont>();
  if (wanted.size === 0) return embedded;

  pdfDoc.registerFontkit(fontkit);
  await Promise.all(
    [...wanted.values()].map(async (resource) => {
      try {
        embedded.set(
          resource.id,
          await pdfDoc.embedFont(new Uint8Array(await resource.bytes())),
        );
      } catch (cause) {
        throw new Error(`Cannot embed font ${resource.family}`, { cause });
      }
    }),
  );
  return embedded;
}

/**
 * Embed the faces a layout measured against, keyed by its resolution ids.
 *
 * Many ids can name one resource — the same face answering requests for a
 * weight nobody supplied — so the bytes go in once and every id points at
 * them.
 */
export async function embedResolvedFonts(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
): Promise<Map<FontResolutionId, PDFFont>> {
  const resolutions = layout.fontResolutions;
  const embedded = new Map<FontResolutionId, PDFFont>();
  if (!resolutions?.size) return embedded;

  const faces = await embedFaces(
    pdfDoc,
    [...resolutions.values()].flatMap((r) => (r.resource ? [r.resource] : [])),
  );
  for (const [id, { resource }] of resolutions) {
    const font = resource && faces.get(resource.id);
    if (font) embedded.set(id, font);
  }
  return embedded;
}

/**
 * Pick the PDFFont for a span.
 *
 * The layout's resolution names the face the geometry was measured from, so
 * it decides. The standard fonts are a guess from the family name, and the
 * only option left when nothing resolved anything — no provider, or a licence
 * that forbids embedding the face that was chosen.
 */
export function resolveFont(
  cssFont: string,
  standardFonts: FontCache,
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

/** Create a PdfFontRegistry from the layout's resolutions and the standard fonts. */
export function createFontRegistry(
  standardFonts: FontCache,
  resolvedFonts: Map<FontResolutionId, PDFFont> = new Map(),
): PdfFontRegistry {
  const embedded = new Set(resolvedFonts.values());
  return {
    resolve: (cssFont, resolution) =>
      resolveFont(cssFont, standardFonts, resolvedFonts, resolution),
    isUnicode: (font: PDFFont) => embedded.has(font),
    fallback: standardFonts["normal"]!,
  };
}
