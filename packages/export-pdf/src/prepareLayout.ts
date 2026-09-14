import { PDFDocument, type PDFFont } from "pdf-lib";
import { createLayoutFontResolver, resolvedKeyOf, type IEditor, type FontRequest, type FontResolution, type FontShortfall, type FontResource, type TextMeasurerLike } from "@scrivr/core";
import { createFontRegistry, embedFaces, embedStandardFonts, resolveFont } from "./fonts";
import { sanitizeForWinAnsi, stripInvisible } from "./context";

const constraints = { portable: true, embeddable: true } as const;
/** A face, without the size it was asked at — one answer serves every size. */
const key = (request: FontRequest) => JSON.stringify([request.family, request.weight, request.style, request.stretch]);
const faceKey = (css: string) => css.replace(/[\d.]+px/, "");
const fontSize = (css: string) => Number(/([\d.]+)px/.exec(css)?.[1] ?? 14);

/** Freeze resolutions and embed their bytes before any export geometry is measured. */
export async function preparePdfLayout(editor: IEditor) {
  const provider = editor.fonts!;
  if (!editor.layoutForExport) throw new Error("Font-aware PDF export requires layoutForExport");
  const doc = editor.getState().doc;
  // Run the same style/layout traversal to discover requests (including headings,
  // tables and font modifiers), rather than guessing from mark names.
  const discovered = new Map<string, FontRequest>();
  const discovery = createLayoutFontResolver({
    defaultRequest: () => provider.defaultRequest(),
    prepare: async () => {},
    resolve: (request, limits) => {
      discovered.set(key(request), request);
      return provider.resolve(request, limits);
    },
  }, constraints);
  editor.layoutForExport(doc, discovery);
  const requests = [...discovered.values()];
  await provider.prepare(requests, constraints);

  const pdfDoc = await PDFDocument.create();
  const standard = await embedStandardFonts(pdfDoc);
  const snapshots = new Map<string, FontResolution>();
  const needed = new Map<string, FontResource>();
  const shortfalls: FontShortfall[] = [];
  const answers = requests.map(request => ({ request, answer: provider.resolve(request, constraints) }));
  for (const { request, answer } of answers) {
    const resource = answer.resource;
    if (resource && (resource.embedding?.allowed === false || !answer.resolved.portable)) {
      throw new Error(`Font provider violated PDF constraints for ${request.family}`);
    }
    let snapshot = answer;
    if (resource) {
      needed.set(resource.id, resource);
      snapshot = { request: { ...request }, resolved: { ...answer.resolved }, resource: { ...resource } };
    }
    snapshots.set(key(request), snapshot);
    if (answer.resolved.source !== "requested" || !answer.resolved.portable) {
      shortfalls.push({ request, resolved: resolvedKeyOf(answer), source: answer.resolved.source, portable: answer.resolved.portable });
    }
  }
  // One embedder for both export paths, so licence and parse failures are
  // handled the same way whichever entry point the caller used.
  const embedded = await embedFaces(pdfDoc, needed.values());

  const resolver = createLayoutFontResolver({
    defaultRequest: () => provider.defaultRequest(), prepare: async () => {},
    resolve: request => {
      const answer = snapshots.get(key(request));
      if (!answer) throw new Error(`Font request changed during PDF layout: ${request.family}`);
      return { ...answer, request };
    },
  }, constraints);
  // Map the measured CSS spelling to the exact embedded face. Size remains a
  // measurement parameter; face identity remains the resolution's resource.
  const byCss = new Map<string, PDFFont>();
  const resolvedFonts = new Map<number, PDFFont>();
  for (const request of requests) {
    const css = `${request.style === "italic" ? "italic " : ""}${request.weight === 400 ? "" : `${request.weight} `}${request.size}px ${request.family}`;
    const result = resolver.resolve(css);
    const answer = resolver.table().get(result.resolution)!;
    const font = (answer.resource && embedded.get(answer.resource.id))
      ?? resolveFont(result.font, standard);
    byCss.set(faceKey(result.font), font);
    resolvedFonts.set(result.resolution, font);
  }
  const registry = createFontRegistry(standard, resolvedFonts);
  // Only owned fonts are Unicode fonts; standard faces still require WinAnsi sanitization.
  const unicode = new Set(embedded.values());
  registry.isUnicode = font => unicode.has(font);
  const originalResolve = registry.resolve;
  const faceFor = (css: string) => {
    const direct = byCss.get(faceKey(css));
    if (direct) return direct;
    // Unstyled/empty lines and inline strategies can ask for base fonts without
    // producing a span. These are measured and painted with the standard fallback.
    return originalResolve(css);
  };
  registry.resolve = (css, id) => id === undefined ? faceFor(css) : originalResolve(css, id);
  const textFor = (text: string, font: PDFFont) => unicode.has(font) ? stripInvisible(text) : sanitizeForWinAnsi(text);
  const width = (text: string, css: string) => {
    const font = faceFor(css);
    return font.widthOfTextAtSize(textFor(text, font), fontSize(css));
  };
  const measurer: TextMeasurerLike = {
    measureWidth: width,
    getFontMetrics: css => {
      const font = faceFor(css), size = fontSize(css);
      const ascent = font.heightAtSize(size, { descender: false });
      const descent = Math.max(0, font.heightAtSize(size) - ascent);
      return { ascent, descent, lineHeight: (ascent + descent) * 1.2, xHeight: ascent * 0.5 };
    },
    measureRun: (text, css) => ({ totalWidth: width(text, css), charPositions: Array.from({ length: text.length }, (_, i) => width(text.slice(0, i), css)) }),
    invalidate: () => {},
  };
  const layout = editor.layoutForExport(doc, resolver, measurer);
  // Resolve IDs discovered at other sizes to the same prepared resources.
  for (const [id, answer] of resolver.table()) {
    const font = answer.resource && embedded.get(answer.resource.id);
    if (font) resolvedFonts.set(id, font);
  }
  return { layout, doc: pdfDoc, fonts: registry, shortfalls };
}
