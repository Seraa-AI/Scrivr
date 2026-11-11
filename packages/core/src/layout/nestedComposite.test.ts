/**
 * A composite nested in a region — a table inside a table cell — is laid out,
 * mapped, hit and floated at every depth, as the outer one is.
 */
import { describe, expect, it } from "vitest";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { CharacterMap } from "./CharacterMap";
import { populateCharMap, registeredLineCount, type LayoutBlock } from "./BlockLayout";
import { defaultPageConfig, runPipeline } from "./PageLayout";
import { regionAtCoords } from "./regionHitTest";
import { createMeasurer } from "../test-utils";

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const table = (...cells: Json[][]): Json => ({
  type: "table",
  attrs: { grid: cells.map(() => 200) },
  content: [{ type: "tableRow", content: cells.map((content) => ({ type: "tableCell", content })) }],
});
const image = { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 60, height: 40, wrapMode: "square", xAlign: "left" } };

function laidOut(content: Json[]) {
  const doc = manager.schema.nodeFromJSON({ type: "doc", content });
  return runPipeline(doc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
}

const outerRow = (blocks: readonly LayoutBlock[]): LayoutBlock => {
  const row = blocks.find((block) => block.kind === "composite");
  if (!row) throw new Error("no row");
  return row;
};

describe("a table nested in a table cell", () => {
  const layout = laidOut([table([table([p("nested")]), p("AFTER")])]);
  const row = outerRow(layout.pages[0]?.blocks ?? []);
  const outerCell = row.regions?.[0];
  const nestedRow = outerCell?.blocks[0];
  const after = outerCell?.blocks[1];

  it("counts its lines in the cell, so the block after it maps to its own line", () => {
    expect(registeredLineCount(row)).toBe(2);
    const map = new CharacterMap();
    populateCharMap(row, map, 1, 0, createMeasurer());
    const at = map.coordsAtPos((after?.nodePos ?? 0) + 2);
    if (!at || !after) throw new Error("no coords");
    const hit = map.posAtCoords(at.x, at.y + 2, 1);
    expect(hit).toBeGreaterThan(after.nodePos);
    expect(hit).toBeLessThan(after.nodePos + after.node.nodeSize);
  });

  it("is hit at its own cell, not the cell around it", () => {
    const nestedCell = nestedRow?.regions?.[0];
    if (!nestedCell || !nestedRow) throw new Error("no nested cell");
    expect(regionAtCoords(layout.pages, nestedCell.x + 5, row.y + nestedRow.y + 5, 1)).toBe(nestedCell.pos);
  });

  it("places an image anchored in its cell", () => {
    const withImage = laidOut([table([table([{ type: "paragraph", content: [image, { type: "text", text: "nested" }] }])])]);
    expect(withImage.anchoredObjects ?? []).toHaveLength(1);
  });
});
