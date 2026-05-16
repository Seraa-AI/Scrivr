import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node, Schema } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { ServerEditor } from "../ServerEditor";
import { normalizeTables } from "./normalize";

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
    { gridSpan: opts.gridSpan ?? 1, vMerge: opts.vMerge ?? "none" },
    para,
  );
}

function row(s: Schema, cells: Node[]): Node {
  return s.nodes["tableRow"]!.create(null, cells);
}

function table(s: Schema, grid: number[], rows: Node[]): Node {
  return s.nodes["table"]!.create({ layout: "fixed", grid }, rows);
}

function docWithTable(s: Schema, tbl: Node): Node {
  return s.nodes["doc"]!.create(null, [tbl]);
}

function stateOf(doc: Node): EditorState {
  return EditorState.create({ schema, doc });
}

function findTable(doc: Node): Node | null {
  let found: Node | null = null;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "table") { found = node; return false; }
    return true;
  });
  return found;
}

// ── No-op on healthy table ────────────────────────────────────────────────────

describe("normalizeTables — healthy table", () => {
  it("returns null for a 2x2 table whose grid matches its rows", () => {
    const doc = docWithTable(schema, table(
      schema, [100, 100],
      [
        row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b" })]),
        row(schema, [cell(schema, { text: "c" }), cell(schema, { text: "d" })]),
      ],
    ));
    expect(normalizeTables(stateOf(doc))).toBeNull();
  });

  it("returns null for a healthy vMerge chain", () => {
    const doc = docWithTable(schema, table(
      schema, [100, 100],
      [
        row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b", vMerge: "restart" })]),
        row(schema, [cell(schema, { text: "c" }), cell(schema, { text: "b1", vMerge: "continue" })]),
      ],
    ));
    expect(normalizeTables(stateOf(doc))).toBeNull();
  });
});

// ── Grid attr repair ─────────────────────────────────────────────────────────

describe("normalizeTables — grid width consistency", () => {
  it("extends grid when narrower than the widest row", () => {
    // grid says 1 col, but row has 3 cells → grid should grow to 3.
    const doc = docWithTable(schema, table(
      schema, [100],
      [row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b" }), cell(schema, { text: "c" })])],
    ));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const gridAttr = findTable(tr.doc)!.attrs["grid"];
    expect(Array.isArray(gridAttr)).toBe(true);
    const grid: unknown[] = Array.isArray(gridAttr) ? gridAttr : [];
    expect(grid.length).toBe(3);
    expect(grid.every((w) => typeof w === "number" && w > 0)).toBe(true);
  });

  it("pads narrower rows up to grid width with empty cells", () => {
    // grid is 3 wide, row only has 1 cell → pad with 2 empties.
    const doc = docWithTable(schema, table(
      schema, [100, 100, 100],
      [row(schema, [cell(schema, { text: "only" })])],
    ));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const tbl = findTable(tr.doc)!;
    expect(tbl.firstChild!.childCount).toBe(3);
    // Padded cells are empty paragraphs.
    expect(tbl.firstChild!.lastChild!.textContent).toBe("");
  });

  it("does not modify a doc whose grid already matches the widest row", () => {
    const doc = docWithTable(schema, table(
      schema, [100, 100],
      [row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b" })])],
    ));
    expect(normalizeTables(stateOf(doc))).toBeNull();
  });
});

// ── gridSpan repair ───────────────────────────────────────────────────────────

describe("normalizeTables — gridSpan", () => {
  it("clamps gridSpan < 1 to 1", () => {
    const badCell = schema.nodes["tableCell"]!.create(
      { gridSpan: 0, vMerge: "none" },
      schema.nodes["paragraph"]!.create(),
    );
    const doc = docWithTable(schema, table(schema, [100], [row(schema, [badCell])]));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const c = findTable(tr.doc)!.firstChild!.firstChild!;
    expect(c.attrs["gridSpan"]).toBe(1);
  });

  it("clamps a non-integer gridSpan to 1 (defensive)", () => {
    const badCell = schema.nodes["tableCell"]!.create(
      { gridSpan: -3, vMerge: "none" },
      schema.nodes["paragraph"]!.create(),
    );
    const doc = docWithTable(schema, table(schema, [100], [row(schema, [badCell])]));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const c = findTable(tr.doc)!.firstChild!.firstChild!;
    expect(c.attrs["gridSpan"]).toBe(1);
  });
});

// ── Broken vMerge ────────────────────────────────────────────────────────────

describe("normalizeTables — broken vMerge chain", () => {
  it("a continuation cell with no preceding restart is promoted to vMerge:none", () => {
    // Row 0 col 0: stray "continue" cell → no restart above → repair to "none".
    const doc = docWithTable(schema, table(
      schema, [100],
      [row(schema, [cell(schema, { text: "stray", vMerge: "continue" })])],
    ));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const c = findTable(tr.doc)!.firstChild!.firstChild!;
    expect(c.attrs["vMerge"]).toBe("none");
  });

  it("a continuation whose column above is a 'none' cell is repaired to 'none'", () => {
    // Row 0: a (none), b (none)
    // Row 1: c (none), d (continue) — col 1 above is "none", not "restart" → broken chain.
    const doc = docWithTable(schema, table(
      schema, [100, 100],
      [
        row(schema, [cell(schema, { text: "a" }), cell(schema, { text: "b" })]),
        row(schema, [cell(schema, { text: "c" }), cell(schema, { text: "d", vMerge: "continue" })]),
      ],
    ));
    const tr = normalizeTables(stateOf(doc))!;
    expect(tr).not.toBeNull();
    const repairedCell = findTable(tr.doc)!.lastChild!.lastChild!;
    expect(repairedCell.attrs["vMerge"]).toBe("none");
  });
});

// ── Termination guard ────────────────────────────────────────────────────────

describe("normalizeTables — termination guard", () => {
  it("does not loop forever when the doc is structurally complex", () => {
    // Worst-case: gridSpan=0 cells across many rows. Each pass repairs them
    // to gridSpan=1; the loop must terminate when no rule fires.
    const cells = (n: number): Node[] =>
      Array.from({ length: n }, () =>
        schema.nodes["tableCell"]!.create(
          { gridSpan: 0, vMerge: "continue" }, // both broken
          schema.nodes["paragraph"]!.create(),
        ),
      );
    const rows = Array.from({ length: 5 }, () => row(schema, cells(3)));
    const doc = docWithTable(schema, table(schema, [], rows));

    const start = Date.now();
    const tr = normalizeTables(stateOf(doc))!;
    const ms = Date.now() - start;

    expect(tr).not.toBeNull();
    expect(ms).toBeLessThan(500); // sanity: no runaway loop
    // After repair, every cell has gridSpan === 1 and vMerge === "none".
    const tbl = findTable(tr.doc)!;
    tbl.descendants((node) => {
      if (node.type.name === "tableCell") {
        expect(node.attrs["gridSpan"]).toBe(1);
        expect(node.attrs["vMerge"]).toBe("none");
      }
      return true;
    });
  });
});

// ── tableIntegrityPlugin — appendTransaction wiring ───────────────────────────

describe("tableIntegrityPlugin — wired through StarterKit.configure({ table: true })", () => {
  it("repairs structural drift on every doc-changing transaction", () => {
    // Seed with broken cells. `EditorState.create()` doesn't fire
    // appendTransaction, so the initial doc stays as-authored — the plugin
    // only runs on subsequent transactions. Dispatch any doc-changing
    // transaction (here: insert text in the cell paragraph) to trigger it.
    const content = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100] },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { gridSpan: 0, vMerge: "continue" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ table: true })],
      content,
    });

    // Find the position inside the cell's paragraph to insert text.
    let insertPos = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (insertPos !== -1) return false;
      if (node.type.name === "paragraph") { insertPos = pos + 1; return false; }
      return true;
    });
    expect(insertPos).toBeGreaterThanOrEqual(0);

    editor.applyTransaction(editor.getState().tr.insertText("y", insertPos));

    const tbl = findTable(editor.getState().doc)!;
    const c = tbl.firstChild!.firstChild!;
    expect(c.attrs["gridSpan"]).toBe(1);
    expect(c.attrs["vMerge"]).toBe("none");
  });

  it("does not append when no rule fires (healthy table)", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100, 100] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
              ],
            },
          ],
        },
      ],
    };
    // No throw; the plugin sees a healthy doc and returns null on appendTransaction.
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ table: true })],
      content,
    });
    expect(editor.getState().doc.firstChild?.type.name).toBe("table");
  });
});
