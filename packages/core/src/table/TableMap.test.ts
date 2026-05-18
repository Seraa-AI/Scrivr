import { describe, it, expect } from "vitest";
import type { Node, Schema } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { buildTableMap, getTableMap } from "./TableMap";

// Tables are opt-in (see tables-default-off changeset). Build a local schema
// that includes the table nodes for these tests.
const schema = new ExtensionManager([StarterKit.configure({ table: true })]).schema;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface CellOpts {
  text?: string;
  gridSpan?: number;
  vMerge?: "none" | "restart" | "continue";
}

function cell(s: Schema, opts: CellOpts = {}): Node {
  const para = opts.text != null
    ? s.nodes["paragraph"]!.create(null, s.text(opts.text))
    : s.nodes["paragraph"]!.create();
  return s.nodes["tableCell"]!.create(
    {
      gridSpan: opts.gridSpan ?? 1,
      vMerge: opts.vMerge ?? "none",
    },
    para,
  );
}

function row(s: Schema, cells: Node[]): Node {
  return s.nodes["tableRow"]!.create(null, cells);
}

function table(s: Schema, grid: number[], rows: Node[]): Node {
  return s.nodes["table"]!.create({ layout: "fixed", grid }, rows);
}

/**
 * Walk a table node and collect each cell's offset (relative to the table
 * start, as TableMap stores them) keyed by its text content. Useful for
 * asserting TableMap.map and findCell against known cells.
 */
function cellOffsetsByText(t: Node): Map<string, number> {
  const out = new Map<string, number>();
  t.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      out.set(node.textContent, pos);
      return false;
    }
    return true;
  });
  return out;
}

// ── Rectangular table ────────────────────────────────────────────────────────

describe("TableMap — rectangular 2x3 table", () => {
  const t = table(
    schema,
    [100, 100, 100],
    [
      row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b" }), cell(schema, { text: "c" })]),
      row(schema, [cell(schema, { text: "d" }), cell(schema, { text: "e" }), cell(schema, { text: "f" })]),
    ],
  );
  const map = buildTableMap(t);
  const offsets = cellOffsetsByText(t);

  it("width matches table.grid length and height matches row count", () => {
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
  });

  it("positionAt(row, col) returns the cell at that grid slot", () => {
    expect(map.positionAt(0, 0)).toBe(offsets.get("a"));
    expect(map.positionAt(0, 2)).toBe(offsets.get("c"));
    expect(map.positionAt(1, 1)).toBe(offsets.get("e"));
  });

  it("positionAt out of range returns null", () => {
    expect(map.positionAt(-1, 0)).toBeNull();
    expect(map.positionAt(0, 3)).toBeNull();
    expect(map.positionAt(2, 0)).toBeNull();
  });

  it("rowSpanAt returns 1 for non-merged cells", () => {
    expect(map.rowSpanAt(offsets.get("a")!)).toBe(1);
    expect(map.rowSpanAt(offsets.get("f")!)).toBe(1);
  });

  it("findCell returns the cell's bounding rect (1x1 for a non-merged cell)", () => {
    expect(map.findCell(offsets.get("e")!)).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
  });

  it("cellsInRect returns all unique cells inside the rect", () => {
    // Whole-table rect (left=0, top=0, right=3, bottom=2) covers all six cells.
    const all = map.cellsInRect({ left: 0, top: 0, right: 3, bottom: 2 });
    expect(new Set(all)).toEqual(new Set(Array.from(offsets.values())));
    expect(all.length).toBe(6);

    // Top row only.
    const topRow = map.cellsInRect({ left: 0, top: 0, right: 3, bottom: 1 });
    expect(new Set(topRow)).toEqual(
      new Set([offsets.get("a"), offsets.get("b"), offsets.get("c")]),
    );
  });
});

// ── Horizontal merge (gridSpan) ───────────────────────────────────────────────

describe("TableMap — horizontal merge via gridSpan", () => {
  // Row 0: span2 (covers cols 0-1) + c
  // Row 1: a, b, c
  const t = table(
    schema,
    [100, 100, 100],
    [
      row(schema, [cell(schema, { text: "span2", gridSpan: 2 }), cell(schema, { text: "c0" })]),
      row(schema, [cell(schema, { text: "a1" }), cell(schema, { text: "b1" }), cell(schema, { text: "c1" })]),
    ],
  );
  const map = buildTableMap(t);
  const offsets = cellOffsetsByText(t);

  it("width === 3, height === 2", () => {
    expect(map.width).toBe(3);
    expect(map.height).toBe(2);
  });

  it("the spanned cell occupies grid columns 0 and 1 of row 0", () => {
    expect(map.positionAt(0, 0)).toBe(offsets.get("span2"));
    expect(map.positionAt(0, 1)).toBe(offsets.get("span2"));
    expect(map.positionAt(0, 2)).toBe(offsets.get("c0"));
  });

  it("findCell of the spanned cell returns a 2-wide rect", () => {
    expect(map.findCell(offsets.get("span2")!)).toEqual({
      left: 0, top: 0, right: 2, bottom: 1,
    });
  });

  it("row 1 still resolves cleanly to its three cells", () => {
    expect(map.positionAt(1, 0)).toBe(offsets.get("a1"));
    expect(map.positionAt(1, 1)).toBe(offsets.get("b1"));
    expect(map.positionAt(1, 2)).toBe(offsets.get("c1"));
  });
});

// ── Vertical merge (vMerge: restart / continue) ───────────────────────────────

describe("TableMap — vertical merge via vMerge chain", () => {
  // Row 0: a, b{restart}, c
  // Row 1: d, e{continue}, f
  const t = table(
    schema,
    [100, 100, 100],
    [
      row(schema, [
        cell(schema, { text: "a0" }),
        cell(schema, { text: "b0", vMerge: "restart" }),
        cell(schema, { text: "c0" }),
      ]),
      row(schema, [
        cell(schema, { text: "a1" }),
        cell(schema, { text: "b1", vMerge: "continue" }),
        cell(schema, { text: "c1" }),
      ]),
    ],
  );
  const map = buildTableMap(t);
  const offsets = cellOffsetsByText(t);

  it("the continuation slot redirects to the restart cell's offset", () => {
    expect(map.positionAt(0, 1)).toBe(offsets.get("b0"));
    expect(map.positionAt(1, 1)).toBe(offsets.get("b0"));
  });

  it("rowSpanAt(restart) === 2 (chain length derived during build)", () => {
    expect(map.rowSpanAt(offsets.get("b0")!)).toBe(2);
  });

  it("findCell(restart) returns a 2-tall rect", () => {
    expect(map.findCell(offsets.get("b0")!)).toEqual({
      left: 1, top: 0, right: 2, bottom: 2,
    });
  });

  it("non-merged cells in surrounding columns are unaffected", () => {
    expect(map.positionAt(0, 0)).toBe(offsets.get("a0"));
    expect(map.positionAt(1, 0)).toBe(offsets.get("a1"));
    expect(map.positionAt(0, 2)).toBe(offsets.get("c0"));
    expect(map.positionAt(1, 2)).toBe(offsets.get("c1"));
  });
});

// ── Combined: horizontal + vertical merge ─────────────────────────────────────

describe("TableMap — combined gridSpan + vMerge", () => {
  // 3-col grid:
  //   Row 0: a, span2-restart (gridSpan: 2, vMerge: restart) → covers cols 1-2 of row 0
  //   Row 1: a1, span2-continue (gridSpan: 2, vMerge: continue) → covers cols 1-2 of row 1
  const t = table(
    schema,
    [100, 100, 100],
    [
      row(schema, [
        cell(schema, { text: "a0" }),
        cell(schema, { text: "merged0", gridSpan: 2, vMerge: "restart" }),
      ]),
      row(schema, [
        cell(schema, { text: "a1" }),
        cell(schema, { text: "merged1", gridSpan: 2, vMerge: "continue" }),
      ]),
    ],
  );
  const map = buildTableMap(t);
  const offsets = cellOffsetsByText(t);

  it("the merged cell covers a 2x2 region", () => {
    expect(map.positionAt(0, 1)).toBe(offsets.get("merged0"));
    expect(map.positionAt(0, 2)).toBe(offsets.get("merged0"));
    expect(map.positionAt(1, 1)).toBe(offsets.get("merged0"));
    expect(map.positionAt(1, 2)).toBe(offsets.get("merged0"));
  });

  it("findCell returns a 2x2 rect; rowSpanAt === 2", () => {
    expect(map.findCell(offsets.get("merged0")!)).toEqual({
      left: 1, top: 0, right: 3, bottom: 2,
    });
    expect(map.rowSpanAt(offsets.get("merged0")!)).toBe(2);
  });
});

// ── Cache identity ───────────────────────────────────────────────────────────

describe("TableMap — getTableMap caches per node identity", () => {
  it("returns the same TableMap instance for the same node", () => {
    const t = table(
      schema,
      [100, 100],
      [row(schema, [cell(schema, { text: "x" }), cell(schema, { text: "y" })])],
    );
    const m1 = getTableMap(t);
    const m2 = getTableMap(t);
    expect(m1).toBe(m2);
  });

  it("returns a different instance for a different node (structural change)", () => {
    const t1 = table(schema, [100], [row(schema, [cell(schema, { text: "x" })])]);
    const t2 = table(schema, [100], [row(schema, [cell(schema, { text: "y" })])]);
    expect(getTableMap(t1)).not.toBe(getTableMap(t2));
  });
});

// ── Defensive build for broken chains ────────────────────────────────────────

describe("TableMap — broken vMerge chain is treated as restart", () => {
  // Row 0: a (vMerge: continue with NO restart above) — should be treated as
  // restart for query purposes. Avoids crashes when normalize hasn't run yet.
  const t = table(
    schema,
    [100],
    [row(schema, [cell(schema, { text: "stray", vMerge: "continue" })])],
  );
  const map = buildTableMap(t);
  const offsets = cellOffsetsByText(t);

  it("orphaned continuation cell still resolves to itself", () => {
    expect(map.positionAt(0, 0)).toBe(offsets.get("stray"));
    expect(map.rowSpanAt(offsets.get("stray")!)).toBe(1);
  });
});
