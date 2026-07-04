import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import {
  cellRangeFromSelection,
  resolveCellRange,
  selectedCells,
  setStoredCellRange,
} from "./cellSelection";
import { serializeCellSelection } from "../input/ClipboardSerializer";

/**
 * Cell selection geometry (Phase 5). A `CellRange` is derived from a text
 * selection that spans cells; a partially-covered merged cell pulls in whole.
 */

interface CellSpec {
  text?: string;
  gridSpan?: number;
  vMerge?: "none" | "restart" | "continue";
}

function cell(spec: CellSpec) {
  return {
    type: "tableCell",
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

function tableDoc(grid: number[], rows: CellSpec[][]) {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { layout: "fixed", grid },
        content: rows.map((cells) => ({ type: "tableRow", content: cells.map(cell) })),
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };
}

function makeEditor(doc: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content: doc });
}

/** Content position inside the (first) cell whose text equals `text`. */
function posInCell(doc: Node, text: string): number {
  let target = -1;
  doc.descendants((n, pos) => {
    if (n.type.name === "tableCell" && n.textContent === text) {
      target = pos + 2; // before cell → into cell → into first paragraph
      return false;
    }
    return true;
  });
  if (target < 0) throw new Error(`no cell with text "${text}"`);
  return target;
}

/** Content position inside the cell at grid (rowIndex, cellIndex). */
function posInCellAt(doc: Node, rowIndex: number, cellIndex: number): number {
  let target = -1;
  doc.descendants((n, pos) => {
    if (n.type.name !== "table") return true;
    let cellPos = pos + 1;
    for (let r = 0; r < rowIndex; r++) cellPos += n.child(r).nodeSize;
    cellPos += 1;
    const row = n.child(rowIndex);
    for (let c = 0; c < cellIndex; c++) cellPos += row.child(c).nodeSize;
    target = cellPos + 2;
    return false;
  });
  if (target < 0) throw new Error(`no cell at ${rowIndex},${cellIndex}`);
  return target;
}

function select(editor: ServerEditor, anchor: number, head: number) {
  editor.applyTransaction(
    editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, anchor, head)),
  );
}

const rect2x2 = () =>
  tableDoc(
    [100, 100],
    [
      [{ text: "A" }, { text: "B" }],
      [{ text: "C" }, { text: "D" }],
    ],
  );

describe("cellRangeFromSelection", () => {
  it("returns null for a caret", () => {
    const editor = makeEditor(rect2x2());
    const p = posInCell(editor.getState().doc, "A");
    select(editor, p, p);
    expect(cellRangeFromSelection(editor.getState())).toBeNull();
  });

  it("returns null for a selection inside a single cell", () => {
    const editor = makeEditor(tableDoc([100], [[{ text: "hello" }]]));
    const doc = editor.getState().doc;
    const start = posInCell(doc, "hello");
    select(editor, start, start + 3); // "hel" within one cell
    expect(cellRangeFromSelection(editor.getState())).toBeNull();
  });

  it("returns null when the selection is outside any table", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    let afterPos = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text === "after") afterPos = pos;
    });
    select(editor, afterPos, afterPos + 3);
    expect(cellRangeFromSelection(editor.getState())).toBeNull();
  });

  it("returns null when one end is outside the table", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const inA = posInCell(doc, "A");
    let afterPos = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text === "after") afterPos = pos + 1;
    });
    select(editor, inA, afterPos);
    expect(cellRangeFromSelection(editor.getState())).toBeNull();
  });

  it("spans two cells in the same row", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    select(editor, posInCell(doc, "A"), posInCell(doc, "B"));
    const range = cellRangeFromSelection(editor.getState());
    expect(range?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
    expect(resolveCellRange(editor.getState(), range!)?.cellPositions).toHaveLength(2);
  });

  it("spans a rectangle across rows and columns", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    select(editor, posInCell(doc, "A"), posInCell(doc, "D"));
    const resolved = selectedCells(editor.getState());
    expect(resolved?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
    expect(resolved?.cellPositions).toHaveLength(4);
  });

  it("is order-independent (head before anchor)", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    select(editor, posInCell(doc, "D"), posInCell(doc, "A"));
    expect(cellRangeFromSelection(editor.getState())?.rect).toEqual({
      left: 0,
      top: 0,
      right: 2,
      bottom: 2,
    });
  });

  it("pulls a partially covered vertical merge in whole", () => {
    // col0 is one cell merged down two rows; select from its continuation
    // (row 1) into the adjacent cell. The rect must include the merge's top row.
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "M", vMerge: "restart" }, { text: "B0" }],
          [{ vMerge: "continue" }, { text: "B1" }],
        ],
      ),
    );
    const doc = editor.getState().doc;
    // anchor in the continuation cell (row 1, col 0), head in B1 (row 1, col 1)
    select(editor, posInCellAt(doc, 1, 0), posInCell(doc, "B1"));
    const range = cellRangeFromSelection(editor.getState());
    expect(range?.rect.top).toBe(0); // merge's top row pulled in
    expect(range?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });

  it("pulls a partially covered horizontal span in whole", () => {
    // row 0 col 0 spans 2 columns; select from a row-1 cell up into the span.
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "wide", gridSpan: 2 }],
          [{ text: "L" }, { text: "R" }],
        ],
      ),
    );
    const doc = editor.getState().doc;
    select(editor, posInCell(doc, "L"), posInCell(doc, "wide"));
    const range = cellRangeFromSelection(editor.getState());
    expect(range?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });
});

/** Position immediately before the cell node at grid (rowIndex, cellIndex). */
function cellNodePos(doc: Node, rowIndex: number, cellIndex: number): number {
  let target = -1;
  doc.descendants((n, pos) => {
    if (n.type.name !== "table") return true;
    let cp = pos + 1;
    for (let r = 0; r < rowIndex; r++) cp += n.child(r).nodeSize;
    cp += 1; // into the row, before its first cell
    const row = n.child(rowIndex);
    for (let c = 0; c < cellIndex; c++) cp += row.child(c).nodeSize;
    target = cp;
    return false;
  });
  if (target < 0) throw new Error(`no cell at ${rowIndex},${cellIndex}`);
  return target;
}

describe("persisted drag range (cellSelectionPlugin)", () => {
  it("selectedCells returns the stored range, preferred over the (empty) text selection", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0), // A
        head: cellNodePos(doc, 1, 1), // D
      }),
    );
    // Text selection is still a caret → derived would be null; stored wins.
    const sel = selectedCells(editor.getState());
    expect(sel?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
    expect(sel?.cellPositions).toHaveLength(4);
  });

  it("a plain caret move clears the stored range", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0),
        head: cellNodePos(doc, 0, 1),
      }),
    );
    expect(selectedCells(editor.getState())).not.toBeNull();

    const s = editor.getState();
    editor.applyTransaction(s.tr.setSelection(TextSelection.create(s.doc, posInCell(s.doc, "A"))));
    expect(selectedCells(editor.getState())).toBeNull();
  });

  it("remaps the stored range through a doc edit", () => {
    const editor = makeEditor(rect2x2());
    const doc0 = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc0, 0, 0), // A
        head: cellNodePos(doc0, 0, 1), // B
      }),
    );
    // Insert text into cell A — positions shift, range must still resolve to A+B.
    const s = editor.getState();
    editor.applyTransaction(s.tr.insertText("XYZ", posInCell(s.doc, "A")));
    const sel = selectedCells(editor.getState());
    expect(sel?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
    expect(sel?.cellPositions).toHaveLength(2);
  });

  it("a compound tx (doc change + selection set) clears the range, not remap", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0), // A
        head: cellNodePos(doc, 0, 1), // B
      }),
    );
    // One tx both edits the doc AND moves the caret — the user has moved on.
    const s = editor.getState();
    const at = posInCell(s.doc, "A");
    const tr = s.tr.insertText("Z", at);
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(at)));
    editor.applyTransaction(tr);
    expect(selectedCells(editor.getState())).toBeNull();
  });

  it("clears the range when an endpoint cell is deleted", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0), // A
        head: cellNodePos(doc, 0, 1), // B — will be deleted
      }),
    );
    expect(selectedCells(editor.getState())).not.toBeNull();

    const s = editor.getState();
    const headPos = cellNodePos(s.doc, 0, 1);
    const cellB = s.doc.nodeAt(headPos);
    if (!cellB) throw new Error("cell B not found");
    editor.applyTransaction(s.tr.delete(headPos, headPos + cellB.nodeSize));
    expect(selectedCells(editor.getState())).toBeNull();
  });

  it("serializeCellSelection copies the stored range as html table + tab/newline text", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0), // A
        head: cellNodePos(doc, 1, 1), // D — whole 2x2
      }),
    );
    const out = serializeCellSelection(editor.getState(), editor.getState().schema);
    expect(out).not.toBeNull();
    expect(out?.text).toBe("A\tB\nC\tD");
    expect(out?.html).toContain("<table>");
    expect(out?.html).toContain("A");
    expect(out?.html).toContain("D");
  });

  it("serializeCellSelection returns null with no cell range", () => {
    const editor = makeEditor(rect2x2());
    expect(serializeCellSelection(editor.getState(), editor.getState().schema)).toBeNull();
  });

  it("explicit null meta clears the range", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    editor.applyTransaction(
      setStoredCellRange(editor.getState().tr, {
        anchor: cellNodePos(doc, 0, 0),
        head: cellNodePos(doc, 1, 0),
      }),
    );
    expect(selectedCells(editor.getState())).not.toBeNull();
    editor.applyTransaction(setStoredCellRange(editor.getState().tr, null));
    expect(selectedCells(editor.getState())).toBeNull();
  });
});
