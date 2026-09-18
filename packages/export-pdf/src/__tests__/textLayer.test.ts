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
import { PDFDocument } from "pdf-lib";
import type { FontResource } from "@scrivr/core";
import { embedFaces } from "../fonts";

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
  bytes: async () => new Uint8Array(readFileSync(require_.resolve("inter-ui/web/Inter-Regular.woff2"))).buffer,
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
 * Shaping a word whose only quotes are double ones, which in Inter builds the
 * single-quote glyphs as a side effect. That is the whole trigger: fontkit
 * keeps the glyph objects it built first, and one built this way carries no
 * codepoint for pdf-lib to name it by.
 */
function soleTextLayer(pdf: Uint8Array): Map<number, string> {
  const layers = textLayers(pdf);
  expect(layers.length).toBe(1);
  const [layer] = layers;
  if (!layer) throw new Error("the embedded face has no text layer");
  return layer;
}

async function pdfAfterMeasuring(text: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const embedded = await embedFaces(pdfDoc, [inter()]);
  const font = embedded.get("inter-400");
  if (!font) throw new Error("face was not embedded");
  font.widthOfTextAtSize(text, 12);
  pdfDoc.addPage().drawText("Party’s ‘aside’", { x: 20, y: 20, size: 12, font });
  return pdfDoc.save();
}

// The ids Inter gives these glyphs.
const QUOTE_LEFT = 1482;
const QUOTE_RIGHT = 1483;
const APOSTROPHE = 1484;
const QUOTE_DOUBLE_LEFT = 1486;

describe("the exported text layer", () => {
  it("names every glyph it embeds", async () => {
    const layer = soleTextLayer(await pdfAfterMeasuring("the “services”,"));
    const unnamed = [...layer].filter(([, text]) => text === "").map(([glyph]) => glyph);
    expect(unnamed).toEqual([]);
  }, 30_000);

  it("gives a copied apostrophe back as an apostrophe", async () => {
    const layer = soleTextLayer(await pdfAfterMeasuring("the “services”,"));
    // `’` shares its glyph with `ʼ`, and must still come back as the one the
    // document was written with.
    expect(layer.get(QUOTE_RIGHT)).toBe("’");
    expect(layer.get(QUOTE_LEFT)).toBe("‘");
    expect(layer.get(APOSTROPHE)).toBe("'");
    expect(layer.get(QUOTE_DOUBLE_LEFT)).toBe("“");
  }, 30_000);

  it("names glyphs the same way whatever was measured first", async () => {
    const straightFirst = soleTextLayer(await pdfAfterMeasuring("don't \"do\" it"));
    const curlyFirst = soleTextLayer(await pdfAfterMeasuring("don’t “do” it"));
    for (const glyph of [QUOTE_LEFT, QUOTE_RIGHT, APOSTROPHE, QUOTE_DOUBLE_LEFT]) {
      expect(curlyFirst.get(glyph)).toBe(straightFirst.get(glyph));
    }
  }, 30_000);
});

