/**
 * A block laid out in side-by-side regions belongs to its extension. This one
 * is written only against `@scrivr/core`'s public surface: a comparison block,
 * one unit per pair, a left and a right region each, with no engine change.
 * The engine lays out what each region holds, as it lays out a list's blocks.
 */
import { describe, expect, it } from "vitest";
import {
  Extension,
  ExtensionManager,
  StarterKit,
  defaultPageConfig,
  regionAtCoords,
  runPipeline,
  type CompositeLayout,
  type LayoutBlock,
} from "../index";
import { createMeasurer } from "../test-utils";

const INSET = { top: 4, right: 8, bottom: 4, left: 8 };

const comparison: CompositeLayout = {
  units: (node, pos) => {
    const units: ReturnType<CompositeLayout["units"]> = [];
    node.forEach((pair, offset) => units.push({ node: pair, pos: pos + 1 + offset, data: null }));
    return units;
  },
  regions: (unit, width) => {
    const regions: ReturnType<CompositeLayout["regions"]> = [];
    unit.node.forEach((side, offset, index) =>
      regions.push({ node: side, pos: unit.pos + 1 + offset, x: index * (width / 2), width: width / 2, inset: INSET }));
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

const manager = new ExtensionManager([StarterKit, Comparisons]);

type Json = { type: string; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const side = (...content: Json[]): Json => ({ type: "side", content });

function laidOut(content: Json[]) {
  const doc = manager.schema.nodeFromJSON({ type: "doc", content });
  return runPipeline(doc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
}

const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right;

describe("a composite block from outside core", () => {
  const layout = laidOut([{ type: "comparison", content: [{ type: "pair", content: [side(p("left")), side(p("right one"), p("right two"))] }] }]);
  const unit = layout.pages[0]?.blocks.find((block) => block.kind === "composite");

  it("is one unit per pair, its regions side by side at the widths it declares", () => {
    expect(unit?.regions?.map((region) => [region.x - defaultPageConfig.margins.left, region.width])).toEqual([
      [0, contentWidth / 2],
      [contentWidth / 2, contentWidth / 2],
    ]);
  });

  it("lays out what each region holds inside its inset, and is as tall as its tallest region", () => {
    const texts = unit?.regions?.map((region) => region.blocks.map((block: LayoutBlock) => block.node.textContent));
    expect(texts).toEqual([["left"], ["right one", "right two"]]);
    const first = unit?.regions?.[0]?.blocks[0];
    expect(first?.x).toBe(defaultPageConfig.margins.left + INSET.left);
    expect(unit?.regions?.map((region) => region.height)).toEqual([unit?.height, unit?.height]);
    expect(unit?.regions?.[1]?.blocks.length).toBe(2);
  });

  it("is hit by region", () => {
    const right = unit?.regions?.[1];
    if (!unit || !right) throw new Error("no unit");
    expect(regionAtCoords(layout.pages, right.x + 10, unit.y + 10, 1)).toBe(right.pos);
  });
});
