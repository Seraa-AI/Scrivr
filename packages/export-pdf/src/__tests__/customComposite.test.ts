/**
 * A composite from outside core prints what its regions hold, as the canvas
 * paints it, with no PDF handler of its own: the exporter dispatches a unit's
 * regions, and a unit's handler, when there is one, draws only decoration.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  Extension,
  ExtensionManager,
  ServerEditor,
  StarterKit,
  TextMeasurer,
  runPipeline,
  type CompositeLayout,
  type TextMeasureContext,
} from "@scrivr/core";
import { buildPdf } from "../index";
import { PAGE_CONFIG } from "./fixtures";
import { recordDrawOps } from "./opLog";

const comparison: CompositeLayout = {
  units: (node, pos) => {
    const units: ReturnType<CompositeLayout["units"]> = [];
    node.forEach((pair, offset) => units.push({ node: pair, pos: pos + 1 + offset, data: null }));
    return units;
  },
  regions: (unit, width) => {
    const regions: ReturnType<CompositeLayout["regions"]> = [];
    unit.node.forEach((side, offset, index) =>
      regions.push({ node: side, pos: unit.pos + 1 + offset, x: index * (width / 2), width: width / 2, inset: { top: 4, right: 8, bottom: 4, left: 8 } }));
    return regions;
  },
};

const Comparisons = Extension.create({
  name: "comparisons",
  addNodes() {
    return {
      comparison: { group: "block", content: "pair+", layout: { kind: "composite", composite: comparison }, toDOM: () => ["div", 0] },
      pair: { content: "side side", toDOM: () => ["div", 0] },
      side: { content: "paragraph+", toDOM: () => ["div", 0] },
    };
  },
});

/** Skia's context supplies the two members a measurer reads. */
function measureContext(ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext {
  return ctx;
}

describe("a composite from outside core, in the PDF", () => {
  it("prints what each region holds", async () => {
    const extensions = [StarterKit, Comparisons];
    const editor = new ServerEditor({ extensions });
    const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: [
      { type: "comparison", content: [{ type: "pair", content: [{ type: "side", content: [p("Before")] }, { type: "side", content: [p("After")] }] }] },
    ] });
    const measurer = new TextMeasurer({ context: measureContext(createCanvas(800, 600).getContext("2d")) });
    const layout = runPipeline(doc, { pageConfig: PAGE_CONFIG, measurer, fontConfig: new ExtensionManager(extensions).buildBlockStyles() });

    const ops = await recordDrawOps(() => buildPdf(layout, editor));
    expect(ops.filter((op) => op.op === "text").map((op) => op["value"])).toEqual(["Before", "After"]);
  });
});
