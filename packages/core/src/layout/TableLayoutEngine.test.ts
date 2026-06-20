import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import { layoutTableRowCells, CELL_PADDING_H, CELL_PADDING_V } from "./TableLayoutEngine";

interface CellSpec {
  text?: string;
  paras?: string[];
  gridSpan?: number;
}

function cell(spec: CellSpec) {
  const paras = spec.paras ?? (spec.text !== undefined ? [spec.text] : [""]);
  return {
    type: "tableCell",
    attrs: {
      gridSpan: spec.gridSpan ?? 1,
      vMerge: "none",
      hMerge: "none",
      hAlign: "left",
      vAlign: "top",
      background: null,
      margins: null,
      borders: null,
    },
    content: paras.map((t) =>
      t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" },
    ),
  };
}

/** Build a one-row table and return its first row node + absolute row position. */
function rowFixture(grid: number[], cells: CellSpec[]): { row: Node; rowNodePos: number; grid: number[] } {
  const content = {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { layout: "fixed", grid },
        content: [{ type: "tableRow", content: cells.map(cell) }],
      },
    ],
  };
  const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content });
  let table: Node | null = null;
  let tablePos = -1;
  editor.getState().doc.descendants((n, p) => {
    if (n.type.name === "table") {
      table = n;
      tablePos = p;
      return false;
    }
    return true;
  });
  if (!table) throw new Error("no table");
  const t: Node = table;
  return { row: t.child(0), rowNodePos: tablePos + 1, grid: t.attrs["grid"] };
}

// availableWidth defaults to the grid sum, so columns scale by 1 and the
// geometry assertions read the raw grid widths. Scaling is covered separately.
const baseCtx = (grid: number[], rowNodePos: number, x = 50, availableWidth?: number) => ({
  x,
  columns: grid,
  availableWidth: availableWidth ?? grid.reduce((s, w) => s + w, 0),
  page: 0,
  rowNodePos,
  measurer: createMeasurer(),
});

describe("TableLayoutEngine — geometry", () => {
  it("places cells at cumulative column x offsets with grid-derived widths", () => {
    const { row, rowNodePos, grid } = rowFixture([120, 80], [{ text: "A" }, { text: "B" }]);
    const { cells } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 50));

    expect(cells).toHaveLength(2);
    expect(cells[0]!.x).toBe(50); // ctx.x + columnX[0]
    expect(cells[0]!.width).toBe(120);
    expect(cells[1]!.x).toBe(50 + 120); // ctx.x + columnX[1]
    expect(cells[1]!.width).toBe(80);
  });

  it("scales columns to fill availableWidth — shrinks a wide grid, stretches a narrow one", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100, 100], [{ text: "A" }, { text: "B" }, { text: "C" }]);

    // Wide grid (300) shrunk into 150 → each column 50, no overflow past x+150.
    const shrunk = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 0, 150)).cells;
    expect(shrunk.map((c) => c.width)).toEqual([50, 50, 50]);
    const lastRight = shrunk[2]!.x + shrunk[2]!.width;
    expect(lastRight).toBeCloseTo(150, 5);

    // Narrow grid stretched to fill 600 → each column 200.
    const stretched = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 0, 600)).cells;
    expect(stretched.map((c) => c.width)).toEqual([200, 200, 200]);
  });

  it("a gridSpan>1 cell spans the summed column widths", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100, 100], [{ text: "AB", gridSpan: 2 }, { text: "C" }]);
    const { cells } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 0));

    expect(cells[0]!.width).toBe(200); // spans columns 0+1
    expect(cells[1]!.x).toBe(200); // third column starts after the span
    expect(cells[1]!.width).toBe(100);
  });

  it("cell x is absolute but cell y is relative to the row top (0)", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100], [{ text: "A" }, { text: "B" }]);
    const { cells } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 200));
    expect(cells[0]!.x).toBe(200);
    expect(cells.every((c) => c.y === 0)).toBe(true);
  });

  it("cellPos matches each cell node's absolute document position", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100], [{ text: "A" }, { text: "B" }]);
    const { cells } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 0));
    // first cell sits at rowNodePos + 1; second after the first cell's nodeSize.
    expect(cells[0]!.cellPos).toBe(rowNodePos + 1);
    expect(cells[1]!.cellPos).toBe(rowNodePos + 1 + row.child(0).nodeSize);
  });
});

describe("TableLayoutEngine — height", () => {
  it("row height is driven by content and exceeds padding for a single line", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100], [{ text: "A" }, { text: "B" }]);
    const { height } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 0));
    // one line of text plus top+bottom padding.
    expect(height).toBeGreaterThan(2 * CELL_PADDING_V);
  });

  it("row height equals the tallest cell (a multi-paragraph cell makes the row taller)", () => {
    const oneLine = rowFixture([100, 100], [{ text: "A" }, { text: "B" }]);
    const short = layoutTableRowCells(oneLine.row, baseCtx(oneLine.grid, oneLine.rowNodePos, 0)).height;

    const tall = rowFixture(
      [100, 100],
      [{ text: "A" }, { paras: ["line one", "line two", "line three"] }],
    );
    const tallHeight = layoutTableRowCells(tall.row, baseCtx(tall.grid, tall.rowNodePos, 0)).height;

    expect(tallHeight).toBeGreaterThan(short);
    // every cell fills the row height
    const { cells } = layoutTableRowCells(tall.row, baseCtx(tall.grid, tall.rowNodePos, 0));
    expect(cells.every((c) => c.height === tallHeight)).toBe(true);
  });

  it("narrow columns wrap long text onto more lines → taller row", () => {
    const text = "the quick brown fox jumps over the lazy dog again and again";
    const wide = rowFixture([400], [{ text }]);
    const narrow = rowFixture([80], [{ text }]);
    const wideH = layoutTableRowCells(wide.row, baseCtx(wide.grid, wide.rowNodePos, 0)).height;
    const narrowH = layoutTableRowCells(narrow.row, baseCtx(narrow.grid, narrow.rowNodePos, 0)).height;
    expect(narrowH).toBeGreaterThan(wideH);
  });

  it("each cell's child blocks start below the top padding", () => {
    const { row, rowNodePos, grid } = rowFixture([100, 100], [{ text: "A" }, { text: "B" }]);
    const { cells } = layoutTableRowCells(row, baseCtx(grid, rowNodePos, 30));
    const firstBlock = cells[0]!.blocks[0]!;
    expect(firstBlock.y).toBe(CELL_PADDING_V); // relative to row top
    expect(firstBlock.x).toBe(30 + CELL_PADDING_H); // absolute content x
  });
});
