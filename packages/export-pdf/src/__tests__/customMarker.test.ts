/**
 * A marker from an extension outside core prints the way it paints: the
 * extension hands the PDF its own painter, written only against the public
 * surface, beside the canvas one.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  Extension,
  ExtensionManager,
  ServerEditor,
  StarterKit,
  TextMeasurer,
  markerAnchorOf,
  runPipeline,
  type BlockMarker,
  type TextMeasureContext,
  type WrapperLayout,
} from "@scrivr/core";
import { buildPdf } from "../index";
import { PT_PER_PX } from "../context";
import { PAGE_CONFIG } from "./fixtures";
import { recordDrawOps } from "./opLog";

const BOX = 12;

const checkbox: BlockMarker = { painter: "checkbox", data: false, hanging: 20, width: () => BOX };

const taskItem: WrapperLayout = {
  enter: (_node, outer) => outer,
  place: (_child, index) => ({ indent: 32, ...(index === 0 ? { marker: checkbox } : {}) }),
};

const TaskList = Extension.create({
  name: "taskList",
  addNodes() {
    return {
      taskList: { group: "block", content: "taskItem+", layout: { kind: "transparent" } },
      taskItem: { content: "paragraph+", layout: { kind: "transparent", wrap: taskItem } },
    };
  },
  addMarkerPainters() {
    return {
      checkbox: {
        canvas: (ctx, marker) => ctx.strokeRect(marker.x, marker.baseline - BOX, BOX, BOX),
        pdf: (marker, ctx) => {
          ctx.draw.rect({ x: marker.x, y: marker.baseline - BOX, width: BOX, height: BOX, border: { color: { r: 0, g: 0, b: 0 }, widthPx: 1 } });
        },
      },
    };
  },
});

/** Skia's context supplies the two members a measurer reads. */
function measureContext(ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext {
  return ctx;
}

describe("a marker painted by an extension outside core, in the PDF", () => {
  it("is drawn by that extension's PDF painter at the marker's anchor", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, TaskList] });
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: [
      { type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] }] },
    ] });
    const measurer = new TextMeasurer({ context: measureContext(createCanvas(800, 600).getContext("2d")) });
    const layout = runPipeline(doc, { pageConfig: PAGE_CONFIG, measurer, fontConfig: new ExtensionManager([StarterKit, TaskList]).buildBlockStyles() });
    const block = layout.pages[0]?.blocks[0];
    if (!block) throw new Error("no block");
    const anchor = markerAnchorOf(block);
    if (!anchor) throw new Error("no marker");

    const ops = await recordDrawOps(() => buildPdf(layout, editor));
    const boxes = ops.filter((op) => op.op === "rect" && op["borderColor"] !== undefined);
    expect(boxes).toEqual([expect.objectContaining({ x: anchor.x * PT_PER_PX, width: BOX * PT_PER_PX })]);
  });
});
