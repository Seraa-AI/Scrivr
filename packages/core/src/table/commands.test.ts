import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { tableStructureCommands } from "./commands";

/**
 * The bound `editor.commands.*` wrapper returns `void`, so to assert the
 * boolean "can this run" contract we dry-run the command factory directly with
 * no dispatch (`cmd(state, undefined)`), which returns the command's boolean
 * without mutating the document.
 */
function canRun(editor: ServerEditor, name: string): boolean {
  return Boolean(tableStructureCommands()[name]!()(editor.getState(), undefined));
}

/**
 * Phase 3 structural table commands. Behaviour is mapped to Microsoft Word so
 * the editing mental model matches user expectations:
 *   - Insert above/below and left/right relative to the selected cell.
 *   - Deleting the last row or column removes the whole table.
 *   - Inserting a row through a vertical merge extends the merge.
 *   - Deleting a vertical merge's top row keeps the merge (one row shorter).
 *   - Inserting a column through a horizontal span grows the span.
 */

interface CellSpec {
  text?: string;
  header?: boolean;
  gridSpan?: number;
  vMerge?: "none" | "restart" | "continue";
}

function cell(spec: CellSpec) {
  return {
    type: spec.header ? "tableHeader" : "tableCell",
    attrs: {
      gridSpan: spec.gridSpan ?? 1,
      vMerge: spec.vMerge ?? "none",
      hMerge: "none",
      hAlign: "left",
      vAlign: "top",
      background: null,
      margins: null,
      borders: null,
    },
    content: [
      spec.text
        ? { type: "paragraph", content: [{ type: "text", text: spec.text }] }
        : { type: "paragraph" },
    ],
  };
}

function tableDoc(grid: number[], rows: CellSpec[][], opts: { trailingParagraph?: boolean } = {}) {
  const content: unknown[] = [
    {
      type: "table",
      attrs: { layout: "fixed", grid },
      content: rows.map((cells) => ({ type: "tableRow", content: cells.map(cell) })),
    },
  ];
  if (opts.trailingParagraph) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

function makeEditor(doc: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content: doc });
}

function getTable(editor: ServerEditor): Node {
  let table: Node | null = null;
  editor.getState().doc.descendants((n) => {
    if (n.type.name === "table") {
      table = n;
      return false;
    }
    return true;
  });
  if (!table) throw new Error("no table in doc");
  return table;
}

/** Row-major view of cell text + structural attrs, for compact assertions. */
function rowsOf(table: Node): Array<Array<{ text: string; span: number; vMerge: string }>> {
  const out: Array<Array<{ text: string; span: number; vMerge: string }>> = [];
  table.forEach((row) => {
    const cells: Array<{ text: string; span: number; vMerge: string }> = [];
    row.forEach((c) => {
      cells.push({
        text: c.textContent,
        span: typeof c.attrs["gridSpan"] === "number" ? c.attrs["gridSpan"] : 1,
        vMerge: String(c.attrs["vMerge"]),
      });
    });
    out.push(cells);
  });
  return out;
}

function gridOf(table: Node): number[] {
  const g = table.attrs["grid"];
  return Array.isArray(g) ? g : [];
}

/** Put the cursor inside the (first) cell whose text content equals `text`. */
function cursorInCellWithText(editor: ServerEditor, text: string) {
  let target = -1;
  editor.getState().doc.descendants((n, pos) => {
    if ((n.type.name === "tableCell" || n.type.name === "tableHeader") && n.textContent === text) {
      target = pos + 2; // pos → before cell; +1 into cell; +1 into its first paragraph
      return false;
    }
    return true;
  });
  if (target < 0) throw new Error(`no cell with text "${text}"`);
  editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, target)));
}

function cursorInCell(editor: ServerEditor, rowIndex: number, cellIndex: number) {
  let target = -1;
  editor.getState().doc.descendants((n, pos) => {
    if (n.type.name !== "table") return true;
    let cellPos = pos + 1;
    for (let r = 0; r < rowIndex; r++) cellPos += n.child(r).nodeSize;
    const row = n.child(rowIndex);
    cellPos += 1;
    for (let c = 0; c < cellIndex; c++) cellPos += row.child(c).nodeSize;
    target = cellPos + 2; // before cell → into cell → into first paragraph
    return false;
  });
  if (target < 0) throw new Error(`no cell at row ${rowIndex}, cell ${cellIndex}`);
  editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, target)));
}

function hasTable(editor: ServerEditor): boolean {
  let found = false;
  editor.getState().doc.descendants((n) => {
    if (n.type.name === "table") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Text of the cell currently containing the selection head. */
function cellTextAtSelection(editor: ServerEditor): string | null {
  const { $from } = editor.getState().selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") return node.textContent;
  }
  return null;
}

const rect2x2 = () =>
  tableDoc(
    [100, 100],
    [
      [{ text: "A" }, { text: "B" }],
      [{ text: "C" }, { text: "D" }],
    ],
  );

// ── Rows ───────────────────────────────────────────────────────────────────────

describe("table commands — rows", () => {
  it("addRowAfter inserts an empty row below the cursor's row", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "A"); // row 0
    expect(canRun(editor, "addRowAfter")).toBe(true);
    editor.commands["addRowAfter"]?.();

    const rows = rowsOf(getTable(editor));
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([
      ["A", "B"],
      ["", ""],
      ["C", "D"],
    ]);
    expect(gridOf(getTable(editor))).toEqual([100, 100]); // grid unchanged by row ops
  });

  it("addRowBefore inserts an empty row above the cursor's row", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "C"); // row 1
    editor.commands["addRowBefore"]?.();

    expect(rowsOf(getTable(editor)).map((r) => r.map((c) => c.text))).toEqual([
      ["A", "B"],
      ["", ""],
      ["C", "D"],
    ]);
  });

  it("deleteRow removes the cursor's row", () => {
    const editor = makeEditor(
      tableDoc(
        [100],
        [[{ text: "r0" }], [{ text: "r1" }], [{ text: "r2" }]],
      ),
    );
    cursorInCellWithText(editor, "r1");
    editor.commands["deleteRow"]?.();

    expect(rowsOf(getTable(editor)).map((r) => r[0]!.text)).toEqual(["r0", "r2"]);
  });

  it("deleteRow on a single-row table removes the whole table (Word: empty table is invalid)", () => {
    const editor = makeEditor(tableDoc([100, 100], [[{ text: "A" }, { text: "B" }]], { trailingParagraph: true }));
    cursorInCellWithText(editor, "A");
    editor.commands["deleteRow"]?.();

    expect(hasTable(editor)).toBe(false);
  });

  it("deleteRow on the only row leaves a valid fallback paragraph when the table is the whole doc", () => {
    const editor = makeEditor(tableDoc([100], [[{ text: "A" }]]));
    cursorInCellWithText(editor, "A");
    editor.commands["deleteRow"]?.();

    expect(hasTable(editor)).toBe(false);
    expect(editor.getState().doc.childCount).toBe(1);
    expect(editor.getState().doc.firstChild?.type.name).toBe("paragraph");
  });
});

// ── Columns ─────────────────────────────────────────────────────────────────────

describe("table commands — columns", () => {
  it("addColumnAfter inserts an empty column to the right and extends the grid", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "A"); // row 0, col 0
    expect(canRun(editor, "addColumnAfter")).toBe(true);
    editor.commands["addColumnAfter"]?.();

    const table = getTable(editor);
    expect(gridOf(table)).toEqual([100, 100, 100]);
    expect(rowsOf(table).map((r) => r.map((c) => c.text))).toEqual([
      ["A", "", "B"],
      ["C", "", "D"],
    ]);
  });

  it("addColumnBefore inserts an empty column to the left", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "B"); // row 0, col 1
    editor.commands["addColumnBefore"]?.();

    expect(rowsOf(getTable(editor)).map((r) => r.map((c) => c.text))).toEqual([
      ["A", "", "B"],
      ["C", "", "D"],
    ]);
    expect(gridOf(getTable(editor))).toEqual([100, 100, 100]);
  });

  it("deleteColumn removes the cursor's column and shrinks the grid", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "B"); // col 1
    editor.commands["deleteColumn"]?.();

    const table = getTable(editor);
    expect(gridOf(table)).toEqual([100]);
    expect(rowsOf(table).map((r) => r.map((c) => c.text))).toEqual([["A"], ["C"]]);
  });

  it("deleteColumn on a single-column table removes the whole table", () => {
    const editor = makeEditor(tableDoc([100], [[{ text: "A" }], [{ text: "B" }]], { trailingParagraph: true }));
    cursorInCellWithText(editor, "A");
    editor.commands["deleteColumn"]?.();

    expect(hasTable(editor)).toBe(false);
  });

  it("deleteColumn on the only column leaves a valid fallback paragraph when the table is the whole doc", () => {
    const editor = makeEditor(tableDoc([100], [[{ text: "A" }], [{ text: "B" }]]));
    cursorInCellWithText(editor, "A");
    editor.commands["deleteColumn"]?.();

    expect(hasTable(editor)).toBe(false);
    expect(editor.getState().doc.childCount).toBe(1);
    expect(editor.getState().doc.firstChild?.type.name).toBe("paragraph");
  });

  it("addColumnAfter yields a grid whose length matches the column count even when grid attr starts empty", () => {
    // A table parsed from HTML can arrive with an empty `grid` attr before the
    // integrity plugin extends it. The command must still land a correctly
    // sized grid (not splice a new width into the wrong slot).
    const editor = makeEditor(
      tableDoc(
        [],
        [
          [{ text: "A" }, { text: "B" }],
          [{ text: "C" }, { text: "D" }],
        ],
      ),
    );
    cursorInCellWithText(editor, "A");
    editor.commands["addColumnAfter"]?.();

    const table = getTable(editor);
    expect(gridOf(table)).toHaveLength(3);
    expect(rowsOf(table).map((r) => r.length)).toEqual([3, 3]);
  });

  it("addColumn inserts a header cell into a header row (keeps the row all-header)", () => {
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "H1", header: true }, { text: "H2", header: true }],
          [{ text: "a" }, { text: "b" }],
        ],
      ),
    );
    cursorInCellWithText(editor, "H1");
    editor.commands["addColumnAfter"]?.();

    const table = getTable(editor);
    // Header row stays all tableHeader; body row stays all tableCell.
    const typeName = (rowIdx: number, cellIdx: number) =>
      table.child(rowIdx).child(cellIdx).type.name;
    expect([0, 1, 2].map((c) => typeName(0, c))).toEqual([
      "tableHeader",
      "tableHeader",
      "tableHeader",
    ]);
    expect([0, 1, 2].map((c) => typeName(1, c))).toEqual([
      "tableCell",
      "tableCell",
      "tableCell",
    ]);
  });

  it("deleteColumn does not nuke a physically multi-column table when grid attr is short", () => {
    // grid says one column, but each row physically has two cells (a state that
    // can exist before the integrity plugin extends the grid). deleteColumn must
    // remove one column, not delete the whole table.
    const editor = makeEditor(
      tableDoc(
        [100],
        [
          [{ text: "A" }, { text: "B" }],
          [{ text: "C" }, { text: "D" }],
        ],
      ),
    );
    cursorInCell(editor, 0, 0);
    editor.commands["deleteColumn"]?.();

    expect(hasTable(editor)).toBe(true);
    const table = getTable(editor);
    expect(rowsOf(table).map((r) => r.map((c) => c.text))).toEqual([["B"], ["D"]]);
  });

  it("addColumn through a horizontal span grows the span, fresh cell elsewhere (Word)", () => {
    // row0: one cell spanning both columns; row1: two single cells.
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "AB", gridSpan: 2 }],
          [{ text: "C" }, { text: "D" }],
        ],
      ),
    );
    cursorInCellWithText(editor, "C"); // row1, col0
    editor.commands["addColumnAfter"]?.(); // insert column at grid index 1

    const table = getTable(editor);
    expect(gridOf(table)).toEqual([100, 100, 100]);
    const rows = rowsOf(table);
    // Spanning cell absorbs the new column → span 3; the single-cell row gets a
    // fresh empty cell between C and D.
    expect(rows[0]).toEqual([{ text: "AB", span: 3, vMerge: "none" }]);
    expect(rows[1]!.map((c) => c.text)).toEqual(["C", "", "D"]);
  });
});

// ── Vertical merge edge cases (mapped to Word) ───────────────────────────────────

describe("table commands — vertical merge", () => {
  // 2 columns × 3 rows; column 0 vertically merged across all three rows.
  const mergedDoc = () =>
    tableDoc(
      [100, 100],
      [
        [{ text: "M", vMerge: "restart" }, { text: "B0" }],
        [{ vMerge: "continue" }, { text: "B1" }],
        [{ vMerge: "continue" }, { text: "B2" }],
      ],
    );

  it("addRowAfter through a vertical merge extends the merge with a continuation", () => {
    const editor = makeEditor(mergedDoc());
    cursorInCellWithText(editor, "B1"); // row 1, col 1 — inside the merge's vertical extent
    editor.commands["addRowAfter"]?.();

    const rows = rowsOf(getTable(editor));
    // 4 rows; the new row lands at index 2, between B1 and B2.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[1]!.text)).toEqual(["B0", "B1", "", "B2"]);
    expect(rows[2]![0]).toEqual({ text: "", span: 1, vMerge: "continue" });
    expect(rows[2]![1]!.vMerge).toBe("none");
    // Merge chain is now restart + 3 continues.
    expect(rows[0]![0]!.vMerge).toBe("restart");
    expect([rows[1]![0]!.vMerge, rows[2]![0]!.vMerge, rows[3]![0]!.vMerge]).toEqual([
      "continue",
      "continue",
      "continue",
    ]);
  });

  it("deleteRow on a vertical merge's top row keeps the merge (promotes the continuation)", () => {
    const editor = makeEditor(mergedDoc());
    cursorInCellWithText(editor, "B0"); // row 0 — the merge master's row
    editor.commands["deleteRow"]?.();

    const rows = rowsOf(getTable(editor));
    expect(rows).toHaveLength(2);
    // The former continuation in (old) row 1 is promoted to the new master.
    expect(rows[0]![0]!.vMerge).toBe("restart");
    expect(rows[1]![0]!.vMerge).toBe("continue");
    expect(rows.map((r) => r[1]!.text)).toEqual(["B1", "B2"]);
  });

  it("commands can run from a vertical merge continuation cell", () => {
    const editor = makeEditor(mergedDoc());
    cursorInCell(editor, 1, 0); // physical continuation cell in row 1 / col 0

    expect(canRun(editor, "addRowAfter")).toBe(true);
    expect(canRun(editor, "deleteRow")).toBe(true);
    expect(canRun(editor, "addColumnAfter")).toBe(true);
    expect(canRun(editor, "deleteColumn")).toBe(true);
    expect(canRun(editor, "goToNextCell")).toBe(true);
  });

  it("addRowAfter from a vertical merge continuation extends that merge at the cursor row", () => {
    const editor = makeEditor(mergedDoc());
    cursorInCell(editor, 1, 0); // physical continuation cell in row 1 / col 0
    editor.commands["addRowAfter"]?.();

    const rows = rowsOf(getTable(editor));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[1]!.text)).toEqual(["B0", "B1", "", "B2"]);
    expect(rows.map((r) => r[0]!.vMerge)).toEqual(["restart", "continue", "continue", "continue"]);
  });

  it("deleteRow from a vertical merge continuation removes that physical row", () => {
    const editor = makeEditor(mergedDoc());
    cursorInCell(editor, 1, 0); // physical continuation cell in row 1 / col 0
    editor.commands["deleteRow"]?.();

    const rows = rowsOf(getTable(editor));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r[1]!.text)).toEqual(["B0", "B2"]);
    expect(rows.map((r) => r[0]!.vMerge)).toEqual(["restart", "continue"]);
  });
});

// ── Navigation ──────────────────────────────────────────────────────────────────

describe("table commands — navigation", () => {
  it("goToNextCell / goToPreviousCell move the selection between cells", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "A");

    expect(canRun(editor, "goToNextCell")).toBe(true);
    editor.commands["goToNextCell"]?.();
    expect(cellTextAtSelection(editor)).toBe("B");

    editor.commands["goToNextCell"]?.();
    expect(cellTextAtSelection(editor)).toBe("C");

    editor.commands["goToPreviousCell"]?.();
    expect(cellTextAtSelection(editor)).toBe("B");
  });

  it("goToNextCell at the last cell is a no-op (row append is Phase 5's Tab handler)", () => {
    const editor = makeEditor(rect2x2());
    cursorInCellWithText(editor, "D"); // last cell
    expect(canRun(editor, "goToNextCell")).toBe(false);
    editor.commands["goToNextCell"]?.();
    expect(cellTextAtSelection(editor)).toBe("D"); // selection unchanged
  });

  it("goToNextCell works from a vertical merge continuation cell", () => {
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "M", vMerge: "restart" }, { text: "B0" }],
          [{ vMerge: "continue" }, { text: "B1" }],
        ],
      ),
    );
    cursorInCell(editor, 1, 0);
    editor.commands["goToNextCell"]?.();

    expect(cellTextAtSelection(editor)).toBe("B1");
  });
});

// ── Guards ──────────────────────────────────────────────────────────────────────

describe("table commands — guards & identity", () => {
  it("structural commands return false when the selection is not inside a table", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "outside" }] }],
    });
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, 1)));

    for (const name of ["addRowAfter", "addColumnAfter", "deleteRow", "deleteColumn", "goToNextCell"]) {
      expect(canRun(editor, name)).toBe(false);
    }
  });

  it("addColumn preserves the Node identity of untouched cells (measure-cache contract)", () => {
    const editor = makeEditor(rect2x2());
    const before = getTable(editor).child(1).child(0); // row1 / col0 — "C"
    cursorInCellWithText(editor, "A");
    editor.commands["addColumnAfter"]?.();

    const after = getTable(editor).child(1).child(0);
    expect(after).toBe(before); // same Node instance → measure cache stays warm
    expect(after.textContent).toBe("C");
  });
});
