import { PDFDocument, type PDFFont } from "pdf-lib";
import {
  createLayoutFontResolver,
  resolvedKeyOf,
  type FontProvider,
  type FontRequest,
  type FontResolution,
  type FontResource,
  type FontShortfall,
  type IEditor,
  type TextMeasurerLike,
} from "@scrivr/core";
import { createFontRegistry, embedFaces, embedStandardFonts, resolveFont } from "./fonts";
import { sanitizeForWinAnsi, stripInvisible } from "./context";

const constraints = { portable: true, embeddable: true } as const;

/** A face, without the size it was asked at — one answer serves every size. */
const key = (request: FontRequest) =>
  JSON.stringify([request.family, request.weight, request.style, request.stretch]);
const faceKey = (css: string) => css.replace(/[\d.]+px/, "");
const fontSize = (css: string) => Number(/([\d.]+)px/.exec(css)?.[1] ?? 14);

interface PreparedAnswers {
  byFace: Map<string, FontResolution>;
  resources: Map<string, FontResource>;
  shortfalls: FontShortfall[];
}

/**
 * Resolve every face a document uses under the conditions a PDF imposes.
 *
 * A provider is free to ignore the constraints it is handed; if it answers with
 * a face that may not be embedded or cannot leave this machine, the export
 * stops. Continuing would mean painting a standard face at coordinates
 * measured from a real one.
 */
function constrainedAnswers(
  provider: FontProvider,
  requests: readonly FontRequest[],
): PreparedAnswers {
  const byFace = new Map<string, FontResolution>();
  const resources = new Map<string, FontResource>();
  const shortfalls: FontShortfall[] = [];

  for (const request of requests) {
    const answer = provider.resolve(request, constraints);
    const { resource, resolved } = answer;
    if (resource && (resource.embedding?.allowed === false || !resolved.portable)) {
      throw new Error(`Font provider violated PDF constraints for ${request.family}`);
    }
    if (resource) {
      resources.set(resource.id, resource);
      // Copied so a provider that mutates its own answers cannot move the
      // geometry after it has been measured against.
      byFace.set(key(request), {
        request: { ...request },
        resolved: { ...resolved },
        resource: { ...resource },
        ...(answer.synthesis ? { synthesis: answer.synthesis } : {}),
      });
    } else {
      byFace.set(key(request), answer);
    }
    if (resolved.source !== "requested" || !resolved.portable) {
      shortfalls.push({
        request,
        resolved: resolvedKeyOf(answer),
        ...(answer.synthesis ? { synthesis: answer.synthesis } : {}),
        source: resolved.source,
        portable: resolved.portable,
      });
    }
  }
  return { byFace, resources, shortfalls };
}

/**
 * A registry that paints a span in the face its resolution names.
 *
 * `faceFor` covers the text that reaches the exporter without a resolution —
 * empty lines, and handlers that name a family — by matching the CSS spelling
 * the prepared faces were measured under, size aside.
 */
function buildRegistry(
  standard: Awaited<ReturnType<typeof embedStandardFonts>>,
  embedded: Map<string, PDFFont>,
  resolvedFonts: Map<number, PDFFont>,
  byCss: Map<string, PDFFont>,
) {
  const registry = createFontRegistry(standard, resolvedFonts);
  // Only owned faces carry their own glyphs; standard ones still need WinAnsi.
  const unicode = new Set(embedded.values());
  registry.isUnicode = (font) => unicode.has(font);
  const byResolution = registry.resolve;
  const faceFor = (css: string) => byCss.get(faceKey(css)) ?? byResolution(css);
  registry.resolve = (css, id) => (id === undefined ? faceFor(css) : byResolution(css, id));
  return { registry, faceFor, unicode };
}

/**
 * Lay the document out again, against the faces that will paint it.
 *
 * Only for the case where the export could not use what the screen resolved —
 * a face the browser has but nobody can embed, or one that had not finished
 * installing. The geometry then genuinely belongs to a different set of faces,
 * so it has to be computed from them rather than reproduced.
 */
function retypeset(
  editor: IEditor,
  doc: Parameters<NonNullable<IEditor["layoutForExport"]>>[0],
  provider: FontProvider,
  prepared: PreparedAnswers,
  embedded: Map<string, PDFFont>,
  standard: Awaited<ReturnType<typeof embedStandardFonts>>,
) {
  const resolver = createLayoutFontResolver(
    {
      defaultRequest: () => provider.defaultRequest(),
      prepare: async () => {},
      resolve: (request) => {
        const answer = prepared.byFace.get(key(request));
        if (!answer) throw new Error(`Font request changed during PDF layout: ${request.family}`);
        return { ...answer, request };
      },
    },
    constraints,
  );

  const byCss = new Map<string, PDFFont>();
  const resolvedFonts = new Map<number, PDFFont>();
  for (const answer of prepared.byFace.values()) {
    const { request } = answer;
    const css = `${request.style === "italic" ? "italic " : ""}${
      request.weight === 400 ? "" : `${request.weight} `
    }${request.size}px ${request.family}`;
    const result = resolver.resolve(css);
    const entry = resolver.table().get(result.resolution);
    const font =
      (entry?.resource && embedded.get(entry.resource.id)) ?? resolveFont(result.font, standard);
    byCss.set(faceKey(result.font), font);
    resolvedFonts.set(result.resolution, font);
  }

  const { registry, faceFor, unicode } = buildRegistry(standard, embedded, resolvedFonts, byCss);
  const textFor = (text: string, font: PDFFont) =>
    unicode.has(font) ? stripInvisible(text) : sanitizeForWinAnsi(text);
  const width = (text: string, css: string) => {
    const font = faceFor(css);
    return font.widthOfTextAtSize(textFor(text, font), fontSize(css));
  };
  const measurer: TextMeasurerLike = {
    measureWidth: width,
    getFontMetrics: (css) => {
      const font = faceFor(css);
      const size = fontSize(css);
      const ascent = font.heightAtSize(size, { descender: false });
      const descent = Math.max(0, font.heightAtSize(size) - ascent);
      return { ascent, descent, lineHeight: (ascent + descent) * 1.2, xHeight: ascent * 0.5 };
    },
    measureRun: (text, css) => ({
      totalWidth: width(text, css),
      charPositions: Array.from({ length: text.length }, (_, i) => width(text.slice(0, i), css)),
    }),
    invalidate: () => {},
  };

  const layout = editor.layoutForExport!(doc, resolver, measurer);
  // Sizes the loop above never spelled resolve to the same prepared faces.
  for (const [id, answer] of resolver.table()) {
    const font = answer.resource && embedded.get(answer.resource.id);
    if (font) resolvedFonts.set(id, font);
  }
  return { layout, registry };
}

/**
 * The layout a PDF should be painted from, and the faces to paint it with.
 *
 * Reproduces the document on screen where it can. The editor has already
 * resolved and measured every face the document uses, so when the export
 * resolves to those same faces there is nothing to recompute — and
 * recomputing it produces a different document, because two engines reading
 * one font file do not agree on advance widths to better than about half a
 * percent, which is enough to move a line break.
 */
export async function preparePdfLayout(editor: IEditor) {
  const provider = editor.fonts;
  if (!provider) throw new Error("Font-aware PDF export requires a font provider");
  if (!editor.layoutForExport) throw new Error("Font-aware PDF export requires layoutForExport");

  editor.ensureFullLayout();
  const onScreen = editor.layout;
  const measured = [...(onScreen.fontResolutions ?? [])];

  const requests = measured.map(([, entry]) => entry.request);
  await provider.prepare(requests, constraints);
  const prepared = constrainedAnswers(provider, requests);

  const pdfDoc = await PDFDocument.create();
  const standard = await embedStandardFonts(pdfDoc);
  // One embedder for both paths, so licence and parse failures are handled the
  // same way whichever entry point the caller used.
  const embedded = await embedFaces(pdfDoc, prepared.resources.values());

  // The screen's answer and the export's, face by face. A face the browser can
  // draw but nobody can embed, or one that had not finished installing when
  // the page was laid out, is a genuine disagreement: the geometry on screen
  // belongs to a face the file cannot carry.
  const reusable = new Map<number, PDFFont>();
  const agrees = measured.every(([id, entry]) => {
    const answer = prepared.byFace.get(key(entry.request));
    if (answer?.resource?.id !== entry.resource?.id) return false;
    const font = answer?.resource && embedded.get(answer.resource.id);
    if (font) reusable.set(id, font);
    return true;
  });

  if (agrees) {
    const { registry } = buildRegistry(standard, embedded, reusable, new Map());
    return { layout: onScreen, doc: pdfDoc, fonts: registry, shortfalls: prepared.shortfalls };
  }

  const { layout, registry } = retypeset(
    editor,
    editor.getState().doc,
    provider,
    prepared,
    embedded,
    standard,
  );
  return { layout, doc: pdfDoc, fonts: registry, shortfalls: prepared.shortfalls };
}
