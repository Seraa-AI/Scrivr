/**
 * The drawing surface, as a handler meets it.
 *
 * A handler works in layout pixels measured from the page's top-left and in
 * `Rgb`, and never performs the conversion to points or the flip to a
 * bottom-left origin. These assert the surface does both, because a handler
 * that has to know either of them is one that had to import pdf-lib.
 */

import { describe, it, expect } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { buildPdf } from "../index";
import { PT_PER_PX } from "../context";
import type { PdfNodeHandler } from "../augmentation";
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
