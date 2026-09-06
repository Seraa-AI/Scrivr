import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { LayoutBlock, PdfFontHandle, PdfImageHandle } from "@scrivr/core";
import { createPdfDrawSurface } from "../surface";
import { recordDrawOps } from "./opLog";

/**
 * The surface is faithful to the calls it replaces.
 *
 * Phase 1 introduces the abstraction and moves no handler, so nothing in
 * production uses it yet — which is exactly the shape that rots. The proof it
 * works is here: each primitive is drawn twice, once through the surface in
 * layout pixels and once the way today's handlers write it in points, and the
 * two operation logs have to be identical.
 *
 * When Phase 2 and 3 move handlers over, this is what says the move cannot
 * change the output.
 */

const PAGE_W_PT = 612;
const PAGE_H_PT = 792;
const PT_PER_PX = 72 / 96;
const flipY = (yPx: number) => PAGE_H_PT - yPx * PT_PER_PX;

async function harness() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W_PT, PAGE_H_PT]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  const fontHandle: PdfFontHandle = { id: "Helvetica" };
  const drawnBlocks: LayoutBlock[] = [];

  const surface = createPdfDrawSurface({
    getPage: () => page,
    pageHeightPt: PAGE_H_PT,
    resources: {
      font: () => helvetica,
      image: () => null,
    },
    theme: { imagePlaceholderBg: "#f5f5f5", imagePlaceholderBorder: "#cccccc" },
    drawBlock: (block) => drawnBlocks.push(block),
  });

  return { page, helvetica, fontHandle, surface, drawnBlocks };
}

/** Runs both spellings of one drawing and returns their logs. */
async function bothWays(
  viaSurface: (h: Awaited<ReturnType<typeof harness>>) => void,
  viaPdfLib: (page: PDFPage, font: PDFFont) => void,
) {
  const h = await harness();
  const surfaceOps = await recordDrawOps(async () => viaSurface(h));
  const rawOps = await recordDrawOps(async () => viaPdfLib(h.page, h.helvetica));
  return { surfaceOps, rawOps };
}

describe("the drawing surface produces what the raw calls produce", () => {
  it("text — layout pixels and a baseline become points and a flipped y", async () => {
    const { surfaceOps, rawOps } = await bothWays(
      ({ surface, fontHandle }) =>
        surface.text({
          text: "Hello",
          x: 72,
          baselineY: 90,
          sizePx: 16,
          font: fontHandle,
          color: { r: 0, g: 0, b: 0 },
        }),
      (page, font) =>
        page.drawText("Hello", {
          x: 72 * PT_PER_PX,
          y: flipY(90),
          size: 16 * PT_PER_PX,
          font,
          color: rgb(0, 0, 0),
        }),
    );
    expect(surfaceOps).toEqual(rawOps);
  });

  it("line — both endpoints flip, thickness converts", async () => {
    const { surfaceOps, rawOps } = await bothWays(
      ({ surface }) =>
        surface.line({
          from: { x: 72, y: 100 },
          to: { x: 200, y: 100 },
          thicknessPx: 1,
          color: { r: 0, g: 102, b: 204 },
        }),
      (page) =>
        page.drawLine({
          start: { x: 72 * PT_PER_PX, y: flipY(100) },
          end: { x: 200 * PT_PER_PX, y: flipY(100) },
          thickness: PT_PER_PX,
          color: rgb(0, 102 / 255, 204 / 255),
        }),
    );
    expect(surfaceOps).toEqual(rawOps);
  });

  it("rect — a top-left box becomes a lower-left one", async () => {
    const { surfaceOps, rawOps } = await bothWays(
      ({ surface }) =>
        surface.rect({
          x: 54,
          y: 200,
          width: 120,
          height: 40,
          color: { r: 254, g: 240, b: 138 },
          opacity: 0.4,
        }),
      (page) =>
        page.drawRectangle({
          x: 54 * PT_PER_PX,
          y: flipY(240),
          width: 120 * PT_PER_PX,
          height: 40 * PT_PER_PX,
          color: rgb(254 / 255, 240 / 255, 138 / 255),
          opacity: 0.4,
        }),
    );
    expect(surfaceOps).toEqual(rawOps);
  });

  it("rect — a border converts alongside the fill", async () => {
    const { surfaceOps, rawOps } = await bothWays(
      ({ surface }) =>
        surface.rect({
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: { r: 255, g: 255, b: 255 },
          border: { color: { r: 156, g: 163, b: 175 }, widthPx: 1 },
        }),
      (page) =>
        page.drawRectangle({
          x: 0,
          y: flipY(10),
          width: 10 * PT_PER_PX,
          height: 10 * PT_PER_PX,
          color: rgb(1, 1, 1),
          borderColor: rgb(156 / 255, 163 / 255, 175 / 255),
          borderWidth: PT_PER_PX,
        }),
    );
    expect(surfaceOps).toEqual(rawOps);
  });

  it("imagePlaceholder — the themed box today's exporter draws", async () => {
    const { surfaceOps, rawOps } = await bothWays(
      ({ surface }) => surface.imagePlaceholder({ x: 100, y: 200, width: 120, height: 80 }),
      (page) =>
        page.drawRectangle({
          x: 100 * PT_PER_PX,
          y: flipY(280),
          width: 120 * PT_PER_PX,
          height: 80 * PT_PER_PX,
          color: rgb(245 / 255, 245 / 255, 245 / 255),
          borderColor: rgb(204 / 255, 204 / 255, 204 / 255),
          borderWidth: 1,
        }),
    );
    expect(surfaceOps).toEqual(rawOps);
  });
});

describe("what the surface refuses to leak", () => {
  it("writes no opacity when a draw is opaque", async () => {
    const h = await harness();
    const ops = await recordDrawOps(async () => {
      h.surface.rect({ x: 0, y: 0, width: 1, height: 1, color: { r: 0, g: 0, b: 0 } });
      h.surface.rect({ x: 0, y: 0, width: 1, height: 1, color: { r: 0, g: 0, b: 0 }, opacity: 1 });
    });
    // pdf-lib would otherwise write a redundant ExtGState for a fully opaque fill.
    expect(ops.every((op) => op["opacity"] === undefined)).toBe(true);
  });

  it("draws nothing for an image whose handle resolves to nothing", async () => {
    const h = await harness();
    const missing: PdfImageHandle = { id: "gone", width: 10, height: 10 };
    const ops = await recordDrawOps(async () =>
      h.surface.image({ image: missing, x: 0, y: 0, width: 10, height: 10 }),
    );
    expect(ops).toEqual([]);
  });

  it("routes a block back through the export's dispatch rather than drawing it", async () => {
    const h = await harness();
    const block = { blockType: "paragraph" } as unknown as LayoutBlock;
    const ops = await recordDrawOps(async () => h.surface.block(block));

    // The surface has no opinion about what a paragraph looks like; it hands
    // the block to whoever owns it.
    expect(h.drawnBlocks).toEqual([block]);
    expect(ops).toEqual([]);
  });
});
