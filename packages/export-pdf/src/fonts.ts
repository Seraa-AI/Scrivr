/**
 * Font resolution and embedding for PDF export.
 * Extracted from the monolithic exporter to support the handler dispatch pattern.
 */

import * as fontkit from "fontkit";
import {
  PDFDocument,
  PDFFont,
  StandardFonts,
} from "pdf-lib";
import type { DocumentLayout, FontResolutionId, FontResource } from "@scrivr/core";
import type { PdfFontRegistry } from "./context";

/** pdf-lib's fontkit contract, taken from the method that consumes it. */
type Fontkit = Parameters<PDFDocument["registerFontkit"]>[0];
type PdfLibFont = ReturnType<Fontkit["create"]>;

/**
 * fontkit, with the one call pdf-lib makes that v2 renamed.
 *
 * pdf-lib drives fontkit v1, whose `Subset.encodeStream()` returned a Node
 * stream; v2 returns the bytes from `encode()`. Adapting that one method is
 * what lets this package use v2 - which matters because v1's subsetter
 * silently drops the outlines of fonts whose `loca` is in the long format,
 * producing correct advances around blank paper.
 */
const subsettingFontkit: Fontkit = {
  // pdf-lib and fontkit declare the same runtime objects with different types.
  // Asserted once, here, rather than at each of pdf-lib's call sites.
  create: (bytes, postscriptName) =>
    assertPdfLibFont(withStreamedSubset(createFont(bytes, postscriptName))),
};

/** fontkit's node build carries `create` on the default export, its browser build on the namespace. */
function createFont(bytes: Uint8Array, postscriptName?: string) {
  const create = fontkit.create ?? fontkit.default?.create;
  if (!create) throw new Error("fontkit exposes no create()");
  return create(bytes, postscriptName);
}

function assertPdfLibFont(font: object): PdfLibFont {
  if (!("createSubset" in font)) throw new Error("fontkit returned no font");
  return font as PdfLibFont;
}

/** Emits `bytes` to the first `data` handler, then ends. pdf-lib chains `on`. */
function bytesAsStream(bytes: Uint8Array) {
  const stream = {
    on(event: string, handler: (chunk?: Uint8Array) => void) {
      if (event === "data") handler(bytes);
      if (event === "end") handler();
      return stream;
    },
  };
  return stream;
}

function withStreamedSubset<T extends object>(font: T): T {
  return new Proxy(font, {
    get(target, property) {
      // `target` as the receiver, so fontkit's own lazy properties cache on the
      // font rather than on the proxy wrapping it.
      const value = Reflect.get(target, property, target);
      if (property !== "createSubset" || typeof value !== "function") return value;
      return () => {
        const subset: unknown = value.call(target);
        if (typeof subset !== "object" || subset === null) return subset;
        return new Proxy(subset, {
          get(subsetTarget, subsetProperty) {
            if (subsetProperty !== "encodeStream") {
              return Reflect.get(subsetTarget, subsetProperty, subsetTarget);
            }
            const encode: unknown = Reflect.get(subsetTarget, "encode", subsetTarget);
            if (typeof encode !== "function") {
              return Reflect.get(subsetTarget, subsetProperty, subsetTarget);
            }
            return () => bytesAsStream(encode.call(subsetTarget));
          },
        });
      };
    },
  });
}

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
 * Embed one set of faces, keyed by the id that identifies them.
 *
 * The single place bytes become a `PDFFont`, so both export paths agree on
 * what may go in a file. Everything it will not carry is an error rather than
 * a silent omission - bytes that will not parse, a web container, a face with
 * no permission to travel - because a face that quietly fails to embed leaves
 * its glyphs at coordinates measured from a typeface the reader will never
 * see, which is the defect this lane exists to remove.
 *
 * Callers that mean to fall back choose a different face before calling: the
 * `embeddable` resolution constraint answers with one that may be carried, and
 * reports the substitution.
 */
export async function embedFaces(
  pdfDoc: PDFDocument,
  resources: Iterable<FontResource>,
): Promise<Map<string, PDFFont>> {
  const wanted = new Map<string, FontResource>();
  for (const resource of resources) {
    if (resource.embedding?.allowed !== true) {
      throw new Error(
        `${resource.family} has no permission to be embedded, so a PDF cannot carry it. ` +
          `Set \`embedding: { allowed: true }\` on the resource when its licence grants that, ` +
          `or resolve with the \`embeddable\` constraint to be answered with a face that may travel.`,
      );
    }
    wanted.set(resource.id, resource);
  }

  const embedded = new Map<string, PDFFont>();
  if (wanted.size === 0) return embedded;

  pdfDoc.registerFontkit(subsettingFontkit);
  await Promise.all(
    [...wanted.values()].map(async (resource) => {
      try {
        const bytes = new Uint8Array(await resource.bytes());
        const container = webFontContainer(bytes);
        if (container) {
          throw new Error(
            `${container} is a web font container, and a PDF can only carry the font program inside it. ` +
              `Register this face as .ttf or .otf bytes.`,
          );
        }
        const font = await pdfDoc.embedFont(bytes, { subset: true });
        nameEveryGlyph(font);
        embedded.set(resource.id, font);
      } catch (cause) {
        throw new Error(`Cannot embed font ${resource.family}`, { cause });
      }
    }),
  );
  return embedded;
}

/**
 * The name of the web font container these bytes are wrapped in, or null when
 * they are already a font program.
 *
 * WOFF and WOFF2 compress a font for the web. fontkit unwraps them, so a face
 * registered that way measures and shapes correctly and nothing upstream
 * notices - but pdf-lib writes the bytes it was given straight into
 * `FontFile2`, where a reader expects the font program itself. The result is a
 * file that renders as a row of dots in one viewer and as a substituted
 * typeface in another, at coordinates measured from neither.
 */
function webFontContainer(bytes: Uint8Array): string | null {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === "wOFF") return "WOFF";
  if (magic === "wOF2") return "WOFF2";
  return null;
}

/** The parts of fontkit's font a cmap walk needs, without depending on it. */
interface CmapWalkable {
  characterSet: readonly number[];
  glyphForCodePoint(codePoint: number): unknown;
}

/**
 * A codepoint that exists to alias a glyph rather than to be typed: modifier
 * letters, the private use area, presentation forms, variation selectors.
 */
function isGlyphAlias(codePoint: number): boolean {
  return (
    (codePoint >= 0x02b0 && codePoint <= 0x02ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
    (codePoint >= 0xfb00 && codePoint <= 0xfdff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  );
}

/**
 * A face's embedder, which pdf-lib declares private. Widened through `unknown`
 * because the checks that follow are runtime ones about a shape pdf-lib does
 * not promise, not casts past the type system's opinion of it.
 */
function embedderOf(font: PDFFont): object | null {
  const candidate: unknown = font;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("embedder" in candidate)) return null;
  const embedder: unknown = candidate.embedder;
  if (typeof embedder !== "object" || embedder === null) return null;
  return embedder;
}

function cmapWalkable(font: PDFFont): CmapWalkable | null {
  const embedder = embedderOf(font);
  if (!embedder) return null;
  if (!("font" in embedder)) return null;
  const inner: unknown = embedder.font;
  if (typeof inner !== "object" || inner === null) return null;
  if (!("characterSet" in inner) || !("glyphForCodePoint" in inner)) return null;
  const { characterSet, glyphForCodePoint } = inner;
  if (!Array.isArray(characterSet)) return null;
  if (typeof glyphForCodePoint !== "function") return null;
  return {
    characterSet,
    glyphForCodePoint: (codePoint) => glyphForCodePoint.call(inner, codePoint),
  };
}

/**
 * Give every glyph the codepoint it will be named by in the PDF's text layer,
 * before any text is measured.
 *
 * fontkit caches glyph objects by id and keeps whichever one was built first,
 * codepoints and all. Shaping can build a glyph without any - measuring
 * `\u201Cquoted\u201D` in Inter is enough to create the single-quote glyphs that
 * way - and pdf-lib then writes an empty `ToUnicode` entry for it. The glyph
 * still paints, so the page looks right while copying or searching the text
 * silently drops the character. Claiming the cache from the cmap first makes
 * the text layer follow the font rather than whatever happened to be measured
 * first. Aliases go last, so a glyph shared by several codepoints is named by
 * the one a reader would type: `\u2019` rather than `\u02BC`.
 */
function nameEveryGlyph(font: PDFFont): void {
  const walkable = cmapWalkable(font);
  if (!walkable) return;
  for (const codePoint of walkable.characterSet) {
    if (!isGlyphAlias(codePoint)) walkable.glyphForCodePoint(codePoint);
  }
  for (const codePoint of walkable.characterSet) {
    if (isGlyphAlias(codePoint)) walkable.glyphForCodePoint(codePoint);
  }
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
