import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createLayoutFontResolver, type IEditor, type FontRequest, type FontResolution, type FontShortfall, type FontResource, type TextMeasurerLike } from "@scrivr/core";
import { createFontRegistry, embedStandardFonts } from "./fonts";
import { sanitizeForWinAnsi, stripInvisible } from "./context";

const constraints = { portable: true, embeddable: true } as const;
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
      discovered.set(JSON.stringify(request), request);
      return provider.resolve(request, limits);
    },
  }, constraints);
  editor.layoutForExport(doc, discovery);
  const requests = [...discovered.values()];
  await provider.prepare(requests, constraints);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const standard = await embedStandardFonts(pdfDoc);
  const snapshots = new Map<string, FontResolution>();
  const embedded = new Map<string, { resource: FontResource; font: PDFFont }>();
  const shortfalls: FontShortfall[] = [];
  const answers = requests.map(request => ({ request, answer: provider.resolve(request, constraints) }));
  for (const { request, answer } of answers) {
    const resource = answer.resource;
    if (resource && (resource.embedding?.allowed === false || !answer.resolved.portable)) {
      throw new Error(`Font provider violated PDF constraints for ${request.family}`);
    }
    let snapshot = answer;
    if (resource) {
      const existing = embedded.get(resource.id);
      if (existing && existing.resource !== resource) throw new Error(`Conflicting font resource id: ${resource.id}`);
      if (!existing) {
        // A resource which cannot embed cannot safely retain its measured geometry.
        // Stop here, before layout, instead of silently painting a standard face.
        let bytes: ArrayBuffer;
        let font: PDFFont;
        try {
          bytes = (await resource.bytes()).slice(0);
          font = await pdfDoc.embedFont(new Uint8Array(bytes));
        } catch (cause) {
          throw new Error(`Cannot embed resolved font ${resource.family}`, { cause });
        }
        embedded.set(resource.id, { resource, font });
      }
      snapshot = { request: { ...request }, resolved: { ...answer.resolved }, resource: { ...resource } };
    }
    snapshots.set(key(request), snapshot);
    if (answer.resolved.source !== "requested" || !answer.resolved.portable) {
      shortfalls.push({ request, resolved: answer.resolved.family, source: answer.resolved.source, portable: answer.resolved.portable });
    }
  }
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
    const font = answer.resource ? embedded.get(answer.resource.id)!.font : createFontRegistry(standard).resolve(result.font);
    byCss.set(faceKey(result.font), font);
    resolvedFonts.set(result.resolution, font);
  }
  const registry = createFontRegistry(standard, resolvedFonts);
  // Only owned fonts are Unicode fonts; standard faces still require WinAnsi sanitization.
  const unicode = new Set([...embedded.values()].map(e => e.font));
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
    if (answer.resource) resolvedFonts.set(id, embedded.get(answer.resource.id)!.font);
  }
  return { layout, doc: pdfDoc, fonts: registry, shortfalls };
}
