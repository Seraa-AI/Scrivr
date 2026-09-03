/**
 * Table units — structured `cells` (decision 2A) with physical-column counting
 * (Σ gridSpan, never TableMap.width), and GFM markdown only for unmerged tables.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";
import { createUnitCtx } from "../context";

function edit(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content });
}

const cell = (text: string, attrs?: Record<string, unknown>) => ({
  type: "tableCell",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const headerCell = (text: string) => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const row = (cells: unknown[]) => ({ type: "tableRow", content: cells });
const table = (rows: unknown[], grid: number[]) => ({
  type: "table",
  attrs: { grid },
  content: rows,
});

describe("table units — simple (no merges)", () => {
  it("emits structured cells with a header row and GFM markdown", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          table(
            [row([headerCell("H1"), headerCell("H2")]), row([cell("a"), cell("b")])],
            [100, 100],
          ),
        ],
      }),
    );
    expect(units).toHaveLength(1);
    const u = units[0]!;
    expect(u.type).toBe("table");
    expect(u.cells!.rows).toHaveLength(2);
    expect(u.cells!.rows[0]!.cells.every((c) => c.header)).toBe(true);
    expect(u.cells!.rows[1]!.cells.every((c) => !c.header)).toBe(true);
    expect(u.cells!.rows[0]!.cells.map((c) => c.text)).toEqual(["H1", "H2"]);
    for (const r of u.cells!.rows)
      for (const c of r.cells) {
        expect(c.gridSpan).toBe(1);
        expect(c.vMerge).toBe("none");
      }
    expect(u.markdown).toContain("|");
  });
});

describe("table units — spanned", () => {
  const doc = {
    type: "doc",
    content: [
      table(
        [row([cell("wide", { gridSpan: 2 })]), row([cell("a"), cell("b")])],
        [100, 100],
      ),
    ],
  };

  it("preserves gridSpan and omits GFM markdown", () => {
    const units = toSemanticUnits(edit(doc));
    const u = units[0]!;
    expect(u.cells!.rows[0]!.cells[0]!.gridSpan).toBe(2);
    // GFM can't encode the span, so markdown is suppressed — rely on cells.
    expect(u.markdown).toBeUndefined();
  });

  it("does not leak structural/layout attrs into unit.attrs or cell.attrs", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          table(
            [row([cell("wide", { gridSpan: 2, hAlign: "center" })]), row([cell("a"), cell("b")])],
            [100, 100],
          ),
        ],
      }),
    );
    const u = units[0]!;
    // grid (column widths) is layout, not semantic styling.
    expect(u.attrs).toBeUndefined();
    const spanned = u.cells!.rows[0]!.cells[0]!;
    // gridSpan/vMerge are their own fields — cell.attrs carries only real styling.
    expect(spanned.attrs).toEqual({ hAlign: "center" });
    expect(spanned.gridSpan).toBe(2);
  });

  it("counts physical columns by summed gridSpan, not TableMap.width", () => {
    const editor = edit(doc);
    const ctx = createUnitCtx(editor, {});
    const tableNode = editor.getState().doc.firstChild!;
    // Widest row = 2 physical columns even though row 1 has a single cell.
    expect(ctx.physicalColumns(tableNode)).toBe(2);
  });

  it("preserves vMerge restart/continue", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          table(
            [
              row([cell("top", { vMerge: "restart" }), cell("r1")]),
              row([cell("bottom", { vMerge: "continue" }), cell("r2")]),
            ],
            [100, 100],
          ),
        ],
      }),
    );
    const rows = units[0]!.cells!.rows;
    expect(rows[0]!.cells[0]!.vMerge).toBe("restart");
    expect(rows[1]!.cells[0]!.vMerge).toBe("continue");
    expect(units[0]!.markdown).toBeUndefined();
  });
});
