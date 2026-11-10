/**
 * A table places its cells across the width it is laid out in, whatever its
 * `grid` attr holds: a grid written by another tool, or never repaired, can
 * name fewer columns than the row has cells, or widths that are no width.
 */
import { describe, expect, it } from "vitest";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { tableLayout } from "./layout";

const schema = new ExtensionManager([StarterKit.configure({ table: true })]).schema;

function regionsOf(grid: unknown[], cellCount: number, width: number) {
  const cells = Array.from({ length: cellCount }, () => ({ type: "tableCell", content: [{ type: "paragraph" }] }));
  const table = schema.nodeFromJSON({ type: "table", attrs: { grid }, content: [{ type: "tableRow", content: cells }] });
  const [unit] = tableLayout.units(table, 0);
  if (!unit) throw new Error("no row");
  return tableLayout.regions(unit, width).map((region) => [region.x, region.width]);
}

describe("a table's cells across its width", () => {
  it("fit the width when the row has more cells than the grid has columns", () => {
    const regions = regionsOf([100, 100], 3, 600);
    expect(regions.map(([, w]) => w)).toEqual([200, 200, 200]);
    expect(regions.map(([x]) => x)).toEqual([0, 200, 400]);
  });

  it("treat a grid width that is no width as a default column", () => {
    expect(regionsOf([-100, 100], 2, 400)).toEqual([[0, 200], [200, 200]]);
  });
});
