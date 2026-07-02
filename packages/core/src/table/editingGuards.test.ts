import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { tabToNextCell, tabToPreviousCell, guardBackspace, guardDelete } from "./editingGuards";

/** Phase 5 editing semantics: Tab navigation, boundary guards, paste distribution. */

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
    ],
  };
}

function makeEditor(doc: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content: doc });
}

const rect2x2 = () =>
  tableDoc(
    [100, 100],
    [
      [{ text: "A" }, { text: "B" }],
      [{ text: "C" }, { text: "D" }],
    ],
  );

function getTable(editor: ServerEditor): Node {
  let table: Node | null = null;
  editor.getState().doc.descendants((n) => {
    if (n.type.name === "table") {
      table = n;
      return false;
    }
    return true;
  });
  if (!table) throw new Error("no table");
  return table;
}

function rowsText(editor: ServerEditor): string[][] {
  const out: string[][] = [];
  getTable(editor).forEach((row) => {
    const cells: string[] = [];
    row.forEach((c) => cells.push(c.textContent));
    out.push(cells);
  });
  return out;
}

function posInCell(doc: Node, text: string, offset = 2): number {
  let target = -1;
  doc.descendants((n, pos) => {
    if (n.type.name === "tableCell" && n.textContent === text) {
      target = pos + offset;
      return false;
    }
    return true;
  });
  if (target < 0) throw new Error(`no cell "${text}"`);
  return target;
}

function caret(editor: ServerEditor, pos: number) {
  editor.applyTransaction(
    editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, pos)),
  );
}

function selectCells(editor: ServerEditor, a: string, b: string) {
  const doc = editor.getState().doc;
  editor.applyTransaction(
    editor.getState().tr.setSelection(
      TextSelection.create(doc, posInCell(doc, a), posInCell(doc, b)),
    ),
  );
}

function run(editor: ServerEditor, cmd: Command): boolean {
  return cmd(editor.getState(), (tr) => editor.applyTransaction(tr));
}

function dryRun(editor: ServerEditor, cmd: Command): boolean {
  return cmd(editor.getState(), undefined);
}

function cellTextAtSelection(editor: ServerEditor): string | null {
  const { $head } = editor.getState().selection;
  for (let d = $head.depth; d > 0; d--) {
    if ($head.node(d).type.name === "tableCell") return $head.node(d).textContent;
  }
  return null;
}

describe("Tab / Shift-Tab navigation", () => {
  it("Tab advances to the next cell", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A"));
    expect(run(editor, tabToNextCell)).toBe(true);
    expect(cellTextAtSelection(editor)).toBe("B");
  });

  it("Tab past the last cell appends a row and lands in its first cell", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "D")); // last cell
    expect(run(editor, tabToNextCell)).toBe(true);
    expect(rowsText(editor)).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["", ""],
    ]);
    expect(cellTextAtSelection(editor)).toBe(""); // first cell of the new row
  });

  it("Tab outside a table defers (returns false)", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    caret(editor, 1);
    expect(dryRun(editor, tabToNextCell)).toBe(false);
  });

  it("Shift-Tab moves to the previous cell", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "B"));
    expect(run(editor, tabToPreviousCell)).toBe(true);
    expect(cellTextAtSelection(editor)).toBe("A");
  });
});

describe("Backspace / Delete boundary guards", () => {
  it("swallows Backspace at the start of a cell", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 2)); // offset 0 within the cell's paragraph
    expect(dryRun(editor, guardBackspace)).toBe(true); // swallowed — no boundary escape
  });

  it("defers Backspace mid-cell to default deletion", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 3)); // after the "A"
    expect(dryRun(editor, guardBackspace)).toBe(false);
  });

  it("swallows Delete at the end of a cell", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 3)); // after "A" == cell end
    expect(dryRun(editor, guardDelete)).toBe(true);
  });

  it("defers Delete mid-cell to default deletion", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 2)); // before "A"
    expect(dryRun(editor, guardDelete)).toBe(false);
  });

  it("Backspace on a multi-cell selection clears the cells", () => {
    const editor = makeEditor(rect2x2());
    selectCells(editor, "A", "D"); // whole table
    expect(run(editor, guardBackspace)).toBe(true);
    expect(rowsText(editor)).toEqual([
      ["", ""],
      ["", ""],
    ]);
  });

  it("Delete on a two-cell row selection clears just those cells", () => {
    const editor = makeEditor(rect2x2());
    selectCells(editor, "A", "B"); // top row only
    expect(run(editor, guardDelete)).toBe(true);
    expect(rowsText(editor)).toEqual([
      ["", ""],
      ["C", "D"],
    ]);
  });

  it("clearing cells is a single undoable step", () => {
    const editor = makeEditor(rect2x2());
    selectCells(editor, "A", "D");
    run(editor, guardBackspace);
    expect(rowsText(editor)).toEqual([
      ["", ""],
      ["", ""],
    ]);
    editor.commands["undo"]?.();
    expect(rowsText(editor)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });
});

// Drives keys through the SAME merged keymap the canvas InputBridge dispatches
// through — the wiring that was previously dead when guards lived in a plugin.
describe("keymap wiring (InputBridge dispatch path)", () => {
  function mergedKey(editor: ServerEditor, key: string): Command {
    const km = editor["manager"].buildKeymap();
    const cmd = km[key];
    if (!cmd) throw new Error(`no merged keymap binding for "${key}"`);
    return cmd;
  }

  it("Tab is wired to cell navigation", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A"));
    expect(run(editor, mergedKey(editor, "Tab"))).toBe(true);
    expect(cellTextAtSelection(editor)).toBe("B");
  });

  it("Tab past the last cell appends a row through the merged keymap", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "D"));
    run(editor, mergedKey(editor, "Tab"));
    expect(rowsText(editor)).toHaveLength(3);
    expect(cellTextAtSelection(editor)).toBe("");
  });

  it("Shift-Tab is wired to reverse cell navigation", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "B"));
    run(editor, mergedKey(editor, "Shift-Tab"));
    expect(cellTextAtSelection(editor)).toBe("A");
  });

  it("Backspace at a cell start is swallowed via the merged keymap", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 2)); // cell start
    run(editor, mergedKey(editor, "Backspace"));
    expect(rowsText(editor)[0]).toEqual(["A", "B"]); // unchanged
  });

  it("Backspace mid-cell falls through to base deletion", () => {
    const editor = makeEditor(rect2x2());
    caret(editor, posInCell(editor.getState().doc, "A", 3)); // after "A"
    run(editor, mergedKey(editor, "Backspace"));
    expect(rowsText(editor)[0]).toEqual(["", "B"]); // base deleted "A"
  });
});

describe("nested content boundary guards", () => {
  const cellAttrs = {
    gridSpan: 1,
    vMerge: "none",
    hMerge: "none",
    hAlign: "left",
    vAlign: "top",
    background: null,
    margins: null,
    borders: null,
  };

  function listCellDoc(items: string[]) {
    return {
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
                  attrs: cellAttrs,
                  content: [
                    {
                      type: "bulletList",
                      content: items.map((t) => ({
                        type: "listItem",
                        content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  function caretBeforeText(editor: ServerEditor, text: string) {
    let pos = -1;
    editor.getState().doc.descendants((n, p) => {
      if (n.isText && n.text === text) pos = p;
    });
    if (pos < 0) throw new Error(`no text "${text}"`);
    caret(editor, pos);
  }

  it("swallows Backspace at the absolute start of a cell (first list item)", () => {
    const editor = makeEditor(listCellDoc(["one", "two"]));
    caretBeforeText(editor, "one");
    expect(dryRun(editor, guardBackspace)).toBe(true);
  });

  it("defers Backspace at the start of a deeper list item", () => {
    const editor = makeEditor(listCellDoc(["one", "two"]));
    caretBeforeText(editor, "two"); // start of 2nd item — not the cell boundary
    expect(dryRun(editor, guardBackspace)).toBe(false);
  });
});
