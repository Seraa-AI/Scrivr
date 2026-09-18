/**
 * What a reader gets when they select, copy or search the exported text.
 *
 * A PDF says twice what a character is: the glyph drawn on the page, and the
 * `ToUnicode` entry that names it. Only the first is visible, so the second can
 * be wrong in a file that looks perfect - and then an apostrophe vanishes on
 * paste and the document is unsearchable for every word containing one.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { FontResource } from "@scrivr/core";
import { completeEmbeddedFaces, embedFaces } from "../fonts";

const require_ = createRequire(import.meta.url);

/**
 * The unsubsetted face, because the shaping that loses the map lives in
 * `calt`, which a latin subset drops - and this is the face the playground
 * registers, so it is the one that has to come out right.
 */
const inter = (): FontResource => ({
  id: "inter-400",
  family: "Inter",
  weight: 400,
  style: "normal",
  bytes: async () => new Uint8Array(readFileSync(require_.resolve("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"))).buffer,
});

/**
 * Every `ToUnicode` map in a PDF, as glyph id → the text a reader copying that
 * glyph receives. Read back from the bytes, because what a viewer does with
 * them is the only thing being claimed here.
 */
function textLayers(pdf: Uint8Array): Map<number, string>[] {
  const buffer = Buffer.from(pdf);
  const latin1 = buffer.toString("latin1");
  const maps: Map<number, string>[] = [];
  for (const match of latin1.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf("endstream", start);
    let body: string;
    try {
      body = inflateSync(buffer.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    if (!body.includes("beginbfchar")) continue;
    const map = new Map<number, string>();
    for (const entry of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      const [, glyph = "", unicode = ""] = entry;
      map.set(
        parseInt(glyph, 16),
        (unicode.match(/.{4}/g) ?? []).map((u) => String.fromCharCode(parseInt(u, 16))).join(""),
      );
    }
    maps.push(map);
  }
  return maps;
}

/**
 * Measure `text`, then draw the quotes, and report the resulting text layer.
 *
 * The order is the trigger: shaping a word whose only quotes are double ones
 * builds Inter's single-quote glyphs as a side effect, and fontkit keeps the
 * glyph objects it built first - so one built that way carries no codepoint
 * for pdf-lib to name it by.
 */
function soleTextLayer(pdf: Uint8Array): Map<number, string> {
  const layers = textLayers(pdf);
  expect(layers.length).toBe(1);
  const [layer] = layers;
  if (!layer) throw new Error("the embedded face has no text layer");
  return layer;
}

async function pdfAfterMeasuring(
  text: string,
): Promise<{ layer: Map<number, string>; idOf: (char: string) => number }> {
  const pdfDoc = await PDFDocument.create();
  const embedded = await embedFaces(pdfDoc, [inter()]);
  const font = embedded.get("inter-400");
  if (!font) throw new Error("face was not embedded");
  font.widthOfTextAtSize(text, 12);
  const page = pdfDoc.addPage();
  page.drawText("Party’s ‘aside’ \"and\" don't", { x: 20, y: 20, size: 12, font });

  // Asked of the font rather than hardcoded, so the assertions below say what
  // the page actually drew instead of what one build of Inter numbers it.
  const idOf = (char: string): number => {
    const id = parseInt(font.encodeText(char).toString().slice(1, 5), 16);
    if (!Number.isFinite(id)) throw new Error(`no glyph for ${char}`);
    return id;
  };
  return { layer: soleTextLayer(await pdfDoc.save()), idOf };
}

describe("embedding a face", () => {
  it("refuses a web font container rather than writing one into the file", async () => {
    const woff2: FontResource = {
      ...inter(),
      bytes: async () =>
        new Uint8Array(readFileSync(require_.resolve("inter-ui/web/Inter-Regular.woff2"))).buffer,
    };
    // Named, because the caller has to know which face to re-register.
    await expect(embedFaces(await PDFDocument.create(), [woff2])).rejects.toThrow(/Inter/);
  }, 30_000);
});

describe("the exported text layer", () => {
  it("names every glyph it embeds", async () => {
    const { layer } = await pdfAfterMeasuring("the “services”,");
    const unnamed = [...layer].filter(([, text]) => text === "").map(([glyph]) => glyph);
    expect(unnamed).toEqual([]);
  }, 30_000);

  it("gives a copied apostrophe back as an apostrophe", async () => {
    const { layer, idOf } = await pdfAfterMeasuring("the “services”,");
    // `’` shares its glyph with `ʼ`, and must still come back as the one the
    // document was written with.
    for (const char of ["’", "‘", "'", "“", "”"]) {
      expect(layer.get(idOf(char))).toBe(char);
    }
  }, 30_000);

  it("names glyphs the same way whatever was measured first", async () => {
    const straightFirst = await pdfAfterMeasuring("don't \"do\" it");
    const curlyFirst = await pdfAfterMeasuring("don’t “do” it");
    for (const char of ["’", "‘", "'", "“"]) {
      const glyph = straightFirst.idOf(char);
      expect(curlyFirst.layer.get(glyph)).toBe(straightFirst.layer.get(glyph));
    }
  }, 30_000);
});


describe("the widths the file declares", () => {
  it("covers every glyph it draws, including one the cmap cannot reach", async () => {
    const pdfDoc = await PDFDocument.create();
    const font = (await embedFaces(pdfDoc, [inter()])).get("inter-400");
    if (!font) throw new Error("face was not embedded");
    // `\uFB01` is not in Inter, so it shapes to .notdef - a glyph no codepoint
    // maps to, which is exactly the shape a ligature has and the case pdf-lib's
    // cmap walk misses.
    pdfDoc.addPage().drawText("shelf \uFB01 office", { x: 20, y: 20, size: 12, font });
    completeEmbeddedFaces(pdfDoc);
    const bytes = await pdfDoc.save();

    const widths = await widthsOf(bytes);
    const drawn = glyphsDrawn(bytes);
    expect(drawn.size).toBeGreaterThan(0);
    expect([...drawn].filter((glyph) => !widths.has(glyph))).toEqual([]);
  }, 30_000);
});

/** Every glyph id the page actually shows. */
function glyphsDrawn(pdf: Uint8Array): Set<number> {
  const buffer = Buffer.from(pdf);
  const latin1 = buffer.toString("latin1");
  const drawn = new Set<number>();
  for (const match of latin1.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf("endstream", start);
    let body: string;
    try {
      body = inflateSync(buffer.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    if (body.includes("beginbfchar")) continue;
    for (const show of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      for (const hex of show[1]?.match(/.{4}/g) ?? []) drawn.add(parseInt(hex, 16));
    }
  }
  return drawn;
}

/** The glyph ids the CID font declares a width for. */
async function widthsOf(pdf: Uint8Array): Promise<Set<number>> {
  const declared = new Set<number>();
  const loaded = await PDFDocument.load(pdf);
  for (const [, object] of loaded.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (String(object.get(PDFName.of("Subtype"))) !== "/CIDFontType2") continue;
    const widths = object.get(PDFName.of("W"));
    if (!(widths instanceof PDFArray)) continue;
    for (let i = 0; i < widths.size(); ) {
      const first = Number(String(widths.get(i)));
      const next = widths.get(i + 1);
      if (next instanceof PDFArray) {
        for (let k = 0; k < next.size(); k++) declared.add(first + k);
        i += 2;
      } else {
        const last = Number(String(next));
        for (let glyph = first; glyph <= last; glyph++) declared.add(glyph);
        i += 3;
      }
    }
  }
  return declared;
}
