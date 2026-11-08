/**
 * An item whose first paragraph holds only a floating image is numbered on
 * that paragraph, as Word numbers it. The PDF draws the numbers layout gave,
 * from a real layout, so it agrees with the canvas, which paints the same
 * blocks.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  ExtensionManager,
  StarterKit,
  TextMeasurer,
  runPipeline,
  type DocumentLayout,
  type TextMeasureContext,
} from "@scrivr/core";
import { buildPdf } from "../index";
import { exportEditor, PAGE_CONFIG, schema } from "./fixtures";
import { recordDrawOps } from "./opLog";

/** Skia's context supplies the two members a measurer reads. */
function measureContext(ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext {
  return ctx;
}

const measurer = new TextMeasurer({ context: measureContext(createCanvas(800, 600).getContext("2d")) });
const fontConfig = new ExtensionManager([StarterKit.configure({ table: true })]).buildBlockStyles();

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const floating: Json = {
  type: "paragraph",
  content: [{ type: "image", attrs: { src: "data:image/png;base64,AA==", width: 40, height: 40, wrapMode: "square" } }],
};
const table: Json = {
  type: "table",
  attrs: { grid: [120] },
  content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] }],
};
const item = (...content: Json[]): Json => ({ type: "listItem", content });
const ordered = (...items: Json[]): Json => ({ type: "orderedList", content: items });

const layoutOf = (content: Json[]): DocumentLayout =>
  runPipeline(schema.nodeFromJSON({ type: "doc", content }), { pageConfig: PAGE_CONFIG, measurer, fontConfig });

const markersIn = (layout: DocumentLayout) =>
  layout.pages.flatMap((page) => page.blocks).flatMap((block) => (block.listMarker ? [block.listMarker] : []));

async function markersDrawn(layout: DocumentLayout): Promise<string[]> {
  const ops = await recordDrawOps(() => buildPdf(layout, exportEditor));
  const numbers = new Set(markersIn(layout));
  return ops.flatMap((op) => (op.op === "text" && typeof op["value"] === "string" && numbers.has(op["value"]) ? [op["value"]] : []));
}

describe("an item that opens with a floating image, in the PDF", () => {
  it.each([
    ["holds nothing else", [ordered(item(floating), item(p("next")))], ["1.", "2."]],
    ["is followed by a table", [ordered(item(floating, table), item(p("next")))], ["1.", "2."]],
    ["is followed by a nested list", [ordered(item(floating, ordered(item(p("child")))), item(p("next")))], ["1.", "a.", "2."]],
  ])("draws its number when it %s", async (_case, content, expected) => {
    const layout = layoutOf(content);
    expect(markersIn(layout)).toEqual(expected);
    expect(await markersDrawn(layout)).toEqual(expected);
  });
});
