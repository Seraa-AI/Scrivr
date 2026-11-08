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
import { PT_PER_PX } from "../context";
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

describe("where the PDF draws a floating-image paragraph's number", () => {
  // BLOCKS THE L1 MERGE. The float's exclusion pass re-lays the paragraph
  // without keepAnchorLine, so its line collapses and the number is drawn at
  // the line's top edge, in the margin when it is first on the page. Fixed,
  // after W1 lands on main, by forwarding a block's first-line settings on
  // every re-break path; this test then passes and `.fails` comes off.
  it.fails("draws it on its own line, inside the page, a line above the next item's", async () => {
    const layout = layoutOf([ordered(item(floating), item(p("next")))]);
    const ops = await recordDrawOps(() => buildPdf(layout, exportEditor));
    const pageHeightPt = PAGE_CONFIG.pageHeight * PT_PER_PX;
    const baselineOf = (value: string) => {
      const op = ops.find((candidate) => candidate.op === "text" && candidate["value"] === value);
      return (pageHeightPt - Number(op?.["y"])) / PT_PER_PX;
    };
    const next = layout.pages.flatMap((page) => page.blocks).find((block) => block.node.textContent === "next");
    const lineHeight = next?.lines[0]?.lineHeight ?? 0;
    expect(baselineOf("1.")).toBeGreaterThan(PAGE_CONFIG.margins.top + lineHeight / 2);
    expect(baselineOf("2.") - baselineOf("1.")).toBeGreaterThanOrEqual(lineHeight);
  });
});

describe("a list inside a table cell, in the PDF", () => {
  const inCell = (list: Json): Json[] => [{
    type: "table",
    attrs: { grid: [300, 300] },
    content: [{ type: "tableRow", content: [
      { type: "tableCell", content: [list] },
      { type: "tableCell", content: [p("other")] },
    ] }],
  }];

  it("draws each item's number and text", async () => {
    const numbered = ordered(item(p("first")), item(p("second")));
    const ops = await recordDrawOps(() => buildPdf(layoutOf(inCell(numbered)), exportEditor));
    const texts = ops.flatMap((op) => (op.op === "text" && typeof op["value"] === "string" ? [op["value"]] : []));
    expect(texts).toEqual(expect.arrayContaining(["1.", "first", "2.", "second"]));
  });

  it("draws a bullet as its shape", async () => {
    const bullets: Json = { type: "bulletList", content: [item(p("point"))] };
    const ops = await recordDrawOps(() => buildPdf(layoutOf(inCell(bullets)), exportEditor));
    expect(ops.filter((op) => op.op === "ellipse")).toHaveLength(1);
  });
});
