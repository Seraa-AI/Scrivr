import { describe, it, expect } from "vitest";
import { Selection, TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { selectedCells, CellSelection, CELL_SELECTION_JSON_ID } from "./cellSelection";
import { cellsCoveredBySelection } from "./cellSelectionSeam";
import { serializeSelectionToHtml, serializeSelectionToText } from "../input/ClipboardSerializer";
import { insertText } from "../model/commands";

/**
 * Cell selection geometry + the `CellSelection` class. A partially-covered
 * merged cell pulls the whole cell into the rect (Word/Docs semantics).
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

const rect2x2 = () =>
  tableDoc(
    [100, 100],
    [
      [{ text: "A" }, { text: "B" }],
      [{ text: "C" }, { text: "D" }],
    ],
  );

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

describe("CellSelection (Selection subclass)", () => {
  it("rejects direct construction with endpoints outside one table", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const $cell = doc.resolve(cellNodePos(doc, 0, 0));
    expect(() => new CellSelection($cell, doc.resolve(0))).toThrow(RangeError);
  });

  it("covers the whole rectangle between two cells", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const sel = CellSelection.between(doc, cellNodePos(doc, 0, 0), cellNodePos(doc, 1, 1));
    expect(sel).not.toBeNull();
    expect(sel!.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
    // The head cell is the primary range → the text anchor lands inside it.
    expect(sel!.$headCell.pos).toBe(cellNodePos(doc, 1, 1));
    expect(sel!.$head.pos).toBeGreaterThan(cellNodePos(doc, 1, 1));
  });

  it("rejects positions that are not both cells of one table", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    expect(CellSelection.between(doc, cellNodePos(doc, 0, 0), 0)).toBeNull();
  });

  it("content() is a standalone table slice of the sub-grid", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const sel = CellSelection.between(doc, cellNodePos(doc, 0, 0), cellNodePos(doc, 1, 0))!;
    const slice = sel.content();
    const table = slice.content.firstChild!;
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2); // two rows (col 0 only)
    expect(table.child(0).childCount).toBe(1); // one cell per row
    expect(table.textContent).toContain("A");
    expect(table.textContent).toContain("C");
    expect(table.textContent).not.toContain("B");
  });

  it("selectedCells resolves a CellSelection to its cell positions", () => {
    const editor = makeEditor(rect2x2());
    const s0 = editor.getState();
    const sel = CellSelection.between(s0.doc, cellNodePos(s0.doc, 0, 0), cellNodePos(s0.doc, 1, 1))!;
    editor.applyTransaction(s0.tr.setSelection(sel));
    const resolved = selectedCells(editor.getState());
    expect(resolved?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
    expect(resolved?.cellPositions).toHaveLength(4);
  });

  it("remaps through an edit and stays a CellSelection", () => {
    const editor = makeEditor(rect2x2());
    const s0 = editor.getState();
    const sel = CellSelection.between(s0.doc, cellNodePos(s0.doc, 0, 0), cellNodePos(s0.doc, 0, 1))!;
    editor.applyTransaction(s0.tr.setSelection(sel));
    const s1 = editor.getState();
    editor.applyTransaction(s1.tr.insertText("XY", posInCell(s1.doc, "A")));
    const mapped = editor.getState().selection;
    expect(mapped).toBeInstanceOf(CellSelection);
    expect(selectedCells(editor.getState())?.cellPositions).toHaveLength(2);
  });

  it("degrades to a text selection when a cell endpoint is deleted", () => {
    const editor = makeEditor(rect2x2());
    const s0 = editor.getState();
    const sel = CellSelection.between(s0.doc, cellNodePos(s0.doc, 0, 0), cellNodePos(s0.doc, 0, 1))!;
    editor.applyTransaction(s0.tr.setSelection(sel));
    const s1 = editor.getState();
    const headPos = cellNodePos(s1.doc, 0, 1);
    const cellB = s1.doc.nodeAt(headPos)!;
    editor.applyTransaction(s1.tr.delete(headPos, headPos + cellB.nodeSize));
    expect(editor.getState().selection).not.toBeInstanceOf(CellSelection);
  });

  it("round-trips through JSON via the registered jsonID", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const sel = CellSelection.between(doc, cellNodePos(doc, 0, 0), cellNodePos(doc, 1, 1))!;
    const json = sel.toJSON();
    expect(json.type).toBe(CELL_SELECTION_JSON_ID);
    const restored = Selection.fromJSON(doc, json);
    expect(restored).toBeInstanceOf(CellSelection);
    expect(restored.eq(sel)).toBe(true);
  });

  it("does not register the legacy unnamespaced JSON id", () => {
    // TODO: Remove after the pre-`scrivr:cell` release window has passed; this
    // only guards a short-lived compatibility boundary for transient state.
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    expect(() =>
      Selection.fromJSON(doc, {
        type: "cell",
        anchor: cellNodePos(doc, 0, 0),
        head: cellNodePos(doc, 1, 1),
      }),
    ).toThrow("No selection type cell defined");
  });

  it("fromJSON degrades invalid/untrusted positions to a non-cell selection", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    // Positions that don't point at two cells of one table (0 is before the
    // table) must not throw or fabricate an unrelated rectangle.
    const restored = Selection.fromJSON(doc, { type: CELL_SELECTION_JSON_ID, anchor: 0, head: 0 });
    expect(restored).not.toBeInstanceOf(CellSelection);
    // Out-of-range garbage is clamped, not thrown.
    expect(() =>
      Selection.fromJSON(doc, { type: CELL_SELECTION_JSON_ID, anchor: 1e9, head: -5 }),
    ).not.toThrow();
  });

  it("resolves its bookmark back to an equal CellSelection", () => {
    const editor = makeEditor(rect2x2());
    const doc = editor.getState().doc;
    const sel = CellSelection.between(doc, cellNodePos(doc, 0, 0), cellNodePos(doc, 1, 0))!;
    const resolved = sel.getBookmark().resolve(doc);
    expect(resolved).toBeInstanceOf(CellSelection);
    expect((resolved as CellSelection).eq(sel)).toBe(true);
  });
});

describe("CellSelection merged-cell normalization", () => {
  it("pulls a partially covered vertical merge in whole", () => {
    // col0 is one cell merged down two rows; anchor in its continuation cell.
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
    const sel = CellSelection.between(doc, cellNodePos(doc, 1, 0), cellNodePos(doc, 1, 1));
    expect(sel!.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });

  it("pulls a partially covered horizontal span in whole", () => {
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
    const sel = CellSelection.between(doc, cellNodePos(doc, 1, 0), cellNodePos(doc, 0, 0));
    expect(sel!.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 2 });
  });
});

describe("cellsCoveredBySelection (cell wash coverage)", () => {
  const bodyAroundTable = () => ({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      {
        type: "table",
        attrs: { layout: "fixed", grid: [100, 100] },
        content: [
          { type: "tableRow", content: [cell({ text: "A" }), cell({ text: "B" })] },
          { type: "tableRow", content: [cell({ text: "C" }), cell({ text: "D" })] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  });

  it("covers every cell when a text selection spans the whole table", () => {
    const editor = makeEditor(bodyAroundTable());
    const doc = editor.getState().doc;
    // Select from the "before" paragraph to the "after" paragraph.
    let beforePos = -1;
    let afterPos = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text === "before") beforePos = pos + 1;
      if (n.isText && n.text === "after") afterPos = pos + 1;
    });
    editor.applyTransaction(
      editor.getState().tr.setSelection(TextSelection.create(doc, beforePos, afterPos)),
    );
    expect(cellsCoveredBySelection(editor.getState()).size).toBe(4);
  });

  it("covers nothing for a selection inside a single cell", () => {
    const editor = makeEditor(bodyAroundTable());
    const doc = editor.getState().doc;
    const start = posInCell(doc, "A");
    editor.applyTransaction(
      editor.getState().tr.setSelection(TextSelection.create(doc, start, start + 1)),
    );
    expect(cellsCoveredBySelection(editor.getState()).size).toBe(0);
  });

  it("covers the CellSelection's own cells", () => {
    const editor = makeEditor(bodyAroundTable());
    const doc = editor.getState().doc;
    const cellPositions: number[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name === "tableCell") cellPositions.push(pos);
    });
    const sel = CellSelection.between(doc, cellPositions[0]!, cellPositions[3]!)!;
    editor.applyTransaction(editor.getState().tr.setSelection(sel));
    expect(cellsCoveredBySelection(editor.getState()).size).toBe(4);
  });
});

describe("typing over a CellSelection", () => {
  it("routes through replace(): clears the other cells instead of only the head cell", () => {
    const editor = makeEditor(rect2x2());
    const s0 = editor.getState();
    const sel = CellSelection.between(s0.doc, cellNodePos(s0.doc, 0, 0), cellNodePos(s0.doc, 1, 1))!;
    editor.applyTransaction(s0.tr.setSelection(sel));
    const tr = insertText(editor.getState(), "X");
    expect(tr).not.toBeNull();
    editor.applyTransaction(tr!);

    const texts: string[] = [];
    editor.getState().doc.descendants((n) => {
      if (n.type.name === "tableCell") texts.push(n.textContent);
    });
    // All four cells were touched: three cleared, exactly one holds the typed text.
    expect(texts).toHaveLength(4);
    expect(texts.filter((t) => t.length > 0)).toEqual(["X"]);
  });
});

describe("clipboard serialization of a CellSelection", () => {
  it("copies as an html table plus tab/newline text", () => {
    const editor = makeEditor(rect2x2());
    const s0 = editor.getState();
    const sel = CellSelection.between(s0.doc, cellNodePos(s0.doc, 0, 0), cellNodePos(s0.doc, 1, 1))!;
    editor.applyTransaction(s0.tr.setSelection(sel));
    const state = editor.getState();
    expect(serializeSelectionToText(state)).toBe("A\tB\nC\tD");
    const html = serializeSelectionToHtml(state, state.schema);
    expect(html).toContain("<table");
    expect(html).toContain("<td");
    expect(html).toContain("A");
    expect(html).toContain("D");
  });

  it("preserves merged-cell spans in clipboard HTML", () => {
    const editor = makeEditor(
      tableDoc(
        [100, 100],
        [
          [{ text: "wide", gridSpan: 2 }],
          [{ text: "down", vMerge: "restart" }, { text: "B" }],
          [{ vMerge: "continue" }, { text: "C" }],
        ],
      ),
    );
    const state = editor.getState();
    const sel = CellSelection.between(
      state.doc,
      cellNodePos(state.doc, 0, 0),
      cellNodePos(state.doc, 2, 1),
    )!;
    editor.applyTransaction(state.tr.setSelection(sel));

    const html = serializeSelectionToHtml(editor.getState(), editor.getState().schema);
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
  });
});
