/**
 * Which face the PDF paints with.
 *
 * The exporter used to derive a font from the family name in the span's CSS
 * string — a second, independent answer to a question layout had already
 * settled. A document measured in one face and painted in another puts every
 * glyph at coordinates computed for different metrics, which is what made
 * spans overlap and swallow the spaces between them.
 *
 * So the thing worth asserting is precedence: the layout's own resolution is
 * consulted first, and the name-based guess only survives where nothing
 * resolved anything.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import type { DocumentLayout, FontResource } from "@scrivr/core";
import { embedStandardFonts, resolveFont, embedResolvedFonts } from "../fonts";

const standard = await embedStandardFonts(await PDFDocument.create());

/**
 * A real typeface, resolved through node_modules rather than an OS path: these
 * assertions are about embedding actual font bytes, and a path that only
 * exists on one developer's platform makes them pass there and nowhere else.
 */
const fontPath = createRequire(import.meta.url).resolve(
  "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
);
const realFontBytes = (): ArrayBuffer => {
  const b = readFileSync(fontPath);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const resource = (
  id: string,
  overrides: Partial<FontResource> = {},
): FontResource => ({
  id,
  family: id,
  weight: 400,
  style: "normal",
  embedding: { allowed: true, source: "caller" },
  bytes: vi.fn(() => Promise.resolve(realFontBytes())),
  ...overrides,
});

/** A layout that resolved its spans to the given resources, one id each. */
const layoutWith = (...resources: FontResource[]): DocumentLayout =>
  ({
    fontResolutions: new Map(
      resources.map((res, id) => [
        id,
        {
          request: { family: "Aptos", weight: 400, style: "normal", size: 14 },
          resolved: { family: res.family, source: "default", portable: true },
          resource: res,
        },
      ]),
    ),
  }) as unknown as DocumentLayout;

describe("choosing the face a span is painted in", () => {
  it("uses the face the layout measured, not the one the name suggests", () => {
    const measured = standard["mono_normal"]!;
    // The CSS string says Georgia, which the name-based guess maps to Times.
    const font = resolveFont("14px Georgia", standard, new Map([[0, measured]]), 0);
    expect(font).toBe(measured);
    expect(font).not.toBe(standard["serif_normal"]);
  });

  it("falls back to the name when the span carries no resolution", () => {
    expect(resolveFont("14px Georgia", standard, new Map(), undefined))
      .toBe(standard["serif_normal"]);
  });

  it("falls back to the name when the resolution could not be embedded", () => {
    // An id with no entry in the map is a face whose bytes never made it in.
    expect(resolveFont("14px Georgia", standard, new Map(), 7))
      .toBe(standard["serif_normal"]);
  });
});

describe("embedding the faces a layout measured", () => {
  it("refuses a face whose licence forbids embedding, without reading its bytes", async () => {
    const denied = resource("Restricted", {
      embedding: { allowed: false, source: "font-metadata" },
    });

    // Refused rather than dropped: a face that quietly fails to embed leaves
    // its glyphs at coordinates measured from a typeface nobody will see.
    await expect(
      embedResolvedFonts(await PDFDocument.create(), layoutWith(denied)),
    ).rejects.toThrow(/Restricted/);
    expect(denied.bytes).not.toHaveBeenCalled();
  });

  it("refuses a face that never claimed permission to be embedded", async () => {
    // Built without the key rather than with it undefined: the case is a
    // resource that never mentioned embedding at all.
    const unknown: FontResource = {
      id: "Unclaimed",
      family: "Unclaimed",
      weight: 400,
      style: "normal",
      bytes: vi.fn(() => Promise.resolve(realFontBytes())),
    };

    await expect(
      embedResolvedFonts(await PDFDocument.create(), layoutWith(unknown)),
    ).rejects.toThrow(/Unclaimed/);
    expect(unknown.bytes).not.toHaveBeenCalled();
  });

  it("reads a face once however many resolutions name it", async () => {
    // Two requests can resolve to one set of bytes — a weight nobody supplied
    // answered by the one that exists.
    const shared = resource("App Sans");
    await embedResolvedFonts(await PDFDocument.create(), layoutWith(shared, shared));

    expect(shared.bytes).toHaveBeenCalledTimes(1);
  });

  it("claims nothing when the layout resolved nothing", async () => {
    const embedded = await embedResolvedFonts(
      await PDFDocument.create(),
      {} as unknown as DocumentLayout,
    );
    expect(embedded.size).toBe(0);
  });

  it("rejects bytes that will not embed", async () => {
    const junk = resource("Corrupt", { bytes: vi.fn(() => Promise.resolve(new ArrayBuffer(8))) });
    await expect(embedResolvedFonts(await PDFDocument.create(), layoutWith(junk))).rejects.toThrow("Cannot embed font Corrupt");
    expect(junk.bytes).toHaveBeenCalled();
  });
});
