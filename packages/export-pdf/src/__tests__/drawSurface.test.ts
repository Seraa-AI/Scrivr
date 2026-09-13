/**
 * The drawing surface, as a handler meets it.
 *
 * Also that a shape's single opacity reaches fill and stroke alike, so a
 * transparent box leaves no visible outline behind it.
 *
 * A handler works in layout pixels measured from the page's top-left and in
 * `Rgb`, and never performs the conversion to points or the flip to a
 * bottom-left origin. These assert the surface does both, because a handler
 * that has to know either of them is one that had to import pdf-lib.
 */

import { describe, it, expect } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { PDFDocument, PDFDict, PDFName, PDFNumber } from "pdf-lib";
import { buildPdf } from "../index";
import { PT_PER_PX } from "../context";
import type { PdfNodeHandler } from "../augmentation";
import type { PdfTextOp } from "@scrivr/core";
import { recordDrawOps } from "./opLog";
import { block, onePage, PAGE_CONFIG } from "./fixtures";

/** Draws one rule across a known box, entirely in layout terms. */
const rule: PdfNodeHandler = (_block, ctx) => {
  ctx.draw.line({
    from: { x: 100, y: 200 },
    to: { x: 300, y: 200 },
    thicknessPx: 2,
    color: { r: 255, g: 0, b: 0 },
  });
};

const Ruler = Extension.create({
  name: "ruler",
  addExports() {
    return {
      pdf: {
        nodes: { horizontalRule: rule },
      },
    };
  },
});

describe.each(["border-only rectangle", "filled rectangle", "missing image"])("%s opacity", kind => {
  it.each([
    [0, 0], [0.4, 0.4], [1, 1], [-1, 0], [2, 1], [Infinity, 1], [-Infinity, 0], [NaN, 0], [undefined, 1],
  ])("applies %s to both fill and stroke", async (opacity, expected) => {
    const handler: PdfNodeHandler = (_block, ctx) => {
      const box = {
        x: 20, y: 20, width: 40, height: 40,
        ...(opacity === undefined ? {} : { opacity }),
      };
      if (kind === "missing image") {
        ctx.draw.image({ ...box, image: { src: "missing" } });
      } else {
        ctx.draw.rect({
          ...box,
          border: { color: { r: 255, g: 0, b: 0 }, widthPx: 2 },
          ...(kind === "filled rectangle" ? { color: { r: 0, g: 0, b: 255 } } : {}),
        });
      }
    };
    const Shape = Extension.create({
      name: "shape",
      addExports: () => ({ pdf: { nodes: { horizontalRule: handler } } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Shape] });
    const pdf = await PDFDocument.load(await buildPdf(ruled, editor));
    // Check the saved graphics state, not just the options sent to pdf-lib:
    // `ca` controls fill/image alpha, while `CA` independently controls stroke.
    const resources = pdf.getPages()[0]!.node.Resources()!;
    const states = resources.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
    const alphas = (states?.entries() ?? []).map(([, value]) => {
      const state = pdf.context.lookup(value, PDFDict);
      return {
        fill: state.lookupMaybe(PDFName.of("ca"), PDFNumber)?.asNumber() ?? 1,
        stroke: state.lookupMaybe(PDFName.of("CA"), PDFNumber)?.asNumber() ?? 1,
      };
    });
    expect(alphas).toEqual(opacity === undefined ? [] : [{ fill: expected, stroke: expected }]);
  });
});

const ruled = onePage([block("horizontalRule", [], { y: 0 })]);

describe("the drawing surface", () => {
  it("converts a handler's pixels to points and flips the axis", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Ruler] });
    const ops = await recordDrawOps(() => buildPdf(ruled, editor));
    const rule = ops.find((op) => op.op === "line" && op["color"] === "rgb(1, 0, 0)");

    expect(rule).toBeDefined();
    // x scales; y is measured from the bottom instead of the top.
    expect(rule?.["start"]).toEqual({
      x: 100 * PT_PER_PX,
      y: PAGE_CONFIG.pageHeight * PT_PER_PX - 200 * PT_PER_PX,
    });
    expect(rule?.["thickness"]).toBe(2 * PT_PER_PX);
  });

  it("draws the built-in rule in exactly the colour it names", async () => {
    // Asserting the value, not that a line appeared — the old painter drew a
    // line too, so op kind alone cannot tell the two implementations apart.
    const editor = new ServerEditor({ extensions: [StarterKit] });
    const ops = await recordDrawOps(() => buildPdf(ruled, editor));
    const rule = ops.find((op) => op.op === "line");
    expect(rule?.["color"]).toBe("rgb(0.796, 0.835, 0.882)");
  });

});

describe("text drawn through the surface", () => {
  const drawing = (op: Partial<PdfTextOp> & { text: string }) => {
    const handler: PdfNodeHandler = (_block, ctx) =>
      ctx.draw.text({
        x: 10,
        baselineY: 20,
        sizePx: 12,
        font: { cssFont: "12px sans-serif" },
        color: { r: 0, g: 0, b: 0 },
        ...op,
      });
    const Writer = Extension.create({
      name: "writer",
      addExports: () => ({ pdf: { nodes: { horizontalRule: handler } } }),
    });
    return recordDrawOps(() =>
      buildPdf(ruled, new ServerEditor({ extensions: [StarterKit, Writer] })),
    );
  };

  it("reduces text to what the resolved font can encode", async () => {
    // A generic family resolves to a standard face, which encodes WinAnsi
    // only. A handler cannot know that — a font handle names a family, not
    // what the exporter made of it — so an unencodable glyph must not take
    // the whole document down with it.
    const ops = await drawing({ text: "a → b" });
    expect(ops.find((op) => op.op === "text")?.["value"]).toBe("a ? b");
  });

  it("draws nothing for text that would leave no ink", async () => {
    const ops = await drawing({ text: "\u200b" });
    expect(ops.some((op) => op.op === "text")).toBe(false);
  });

  it("places the run at its baseline, converted and flipped", async () => {
    const ops = await drawing({ text: "x" });
    const text = ops.find((op) => op.op === "text");
    expect(text?.["x"]).toBe(10 * PT_PER_PX);
    expect(text?.["y"]).toBe(PAGE_CONFIG.pageHeight * PT_PER_PX - 20 * PT_PER_PX);
    expect(text?.["size"]).toBe(12 * PT_PER_PX);
  });
});
