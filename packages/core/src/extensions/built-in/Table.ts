import { Extension } from "../Extension";
import { TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Node, NodeSpec, Schema } from "prosemirror-model";
import { TableRowStrategy } from "../../layout/TableRowStrategy";
import { tableIntegrityPlugin } from "../../table/normalize";

/**
 * Table extension.
 *
 * What lands now:
 *   - Word-shaped schema for `table` / `tableRow` / `tableCell` / `tableHeader`.
 *   - `insertTable({ rows, cols })` and `deleteTable()` commands.
 *   - Placeholder canvas rendering via `TableRowStrategy` (one bordered box
 *     per row).
 *   - PageLayout dispatches each row as an atomic block (whole-row pagination).
 *   - `tableIntegrityPlugin()` — document-validity normalization on every
 *     doc-changing transaction (grid/gridSpan/vMerge repair, row padding).
 *
 * What is intentionally deferred:
 *   - Editing-UX guards plugin (cross-cell selection promotion, Tab/Backspace
 *     semantics) — lands in a separate plugin so the two concerns stay
 *     testable in isolation.
 *   - Add/delete row/column commands, merge/split, header toggle.
 *   - Real cell layout, cell content rendering, PDF parity.
 *   - HTML paste round-trip, DOCX export.
 */

const DEFAULT_COLUMN_WIDTH = 100; // CSS px — uniform default; resizing arrives in Phase 9.

const VALID_HALIGNS = ["left", "center", "right", "justify"] as const;
const VALID_VALIGNS = ["top", "center", "bottom"] as const;
const VALID_VMERGE = ["none", "restart", "continue"] as const;

function uniformGrid(cols: number): number[] {
  return Array.from({ length: cols }, () => DEFAULT_COLUMN_WIDTH);
}

// ── Schema ────────────────────────────────────────────────────────────────────

function tableSpec(): NodeSpec {
  return {
    group: "block",
    content: "tableRow+",
    isolating: true,
    attrs: {
      layout: { default: "fixed" },
      grid: { default: [] as number[] },
    },
    parseDOM: [{ tag: "table" }],
    toDOM() {
      // Phase 1 keeps DOM serialization minimal — the canvas renderer is
      // authoritative. HTML paste round-trip lands in Phase 7.
      return ["table", ["tbody", 0]];
    },
  };
}

function tableRowSpec(): NodeSpec {
  return {
    content: "(tableCell | tableHeader)+",
    attrs: {
      repeatHeader: { default: false },
      allowBreakAcrossPages: { default: false },
    },
    parseDOM: [{ tag: "tr" }],
    toDOM() {
      return ["tr", 0];
    },
  };
}

function cellAttrs(): NonNullable<NodeSpec["attrs"]> {
  return {
    gridSpan: { default: 1 },
    vMerge: { default: "none" },
    hMerge: { default: "none" },
    hAlign: { default: "left" },
    vAlign: { default: "top" },
    background: { default: null },
    margins: { default: null },
    borders: { default: null },
  };
}

function tableCellSpec(): NodeSpec {
  return {
    content: "block+",
    isolating: true,
    attrs: cellAttrs(),
    parseDOM: [{ tag: "td" }],
    toDOM() {
      return ["td", 0];
    },
  };
}

function tableHeaderSpec(): NodeSpec {
  return {
    content: "block+",
    isolating: true,
    attrs: cellAttrs(),
    parseDOM: [{ tag: "th" }],
    toDOM() {
      return ["th", 0];
    },
  };
}

// ── Insert / delete commands ──────────────────────────────────────────────────

interface InsertTableArgs {
  rows: number;
  cols: number;
}

function isInsertTableArgs(value: unknown): value is InsertTableArgs {
  if (typeof value !== "object" || value === null) return false;
  if (!("rows" in value) || !("cols" in value)) return false;
  const r = (value as { rows: unknown }).rows;
  const c = (value as { cols: unknown }).cols;
  return Number.isInteger(r) && Number.isInteger(c) && (r as number) > 0 && (c as number) > 0;
}

function buildEmptyTable(schema: Schema, rows: number, cols: number): Node {
  const tableType = schema.nodes["table"];
  const rowType = schema.nodes["tableRow"];
  const cellType = schema.nodes["tableCell"];
  const paragraphType = schema.nodes["paragraph"];
  if (!tableType || !rowType || !cellType || !paragraphType) {
    throw new Error("Table extension requires table/tableRow/tableCell/paragraph in the schema.");
  }

  const emptyParagraph = paragraphType.create();
  const emptyCell = cellType.create(null, emptyParagraph);
  const rowChildren: Node[] = [];
  for (let i = 0; i < cols; i++) rowChildren.push(emptyCell);
  const row = rowType.create(null, rowChildren);

  const rowsArr: Node[] = [];
  for (let r = 0; r < rows; r++) rowsArr.push(row);

  return tableType.create({ layout: "fixed", grid: uniformGrid(cols) }, rowsArr);
}

function insertTableCommand(args: unknown): Command {
  return (state, dispatch) => {
    if (!isInsertTableArgs(args)) return false;
    if (!state.schema.nodes["table"]) return false;

    const { $from } = state.selection;
    // Insert after the current top-level block — mirrors HorizontalRule and
    // PageBreak. Avoids the structural-replace inside a paragraph that would
    // otherwise be required and keeps undo legible (one step inserts the
    // table without disturbing the surrounding block).
    const insertPos = $from.after(1);
    const table = buildEmptyTable(state.schema, args.rows, args.cols);

    if (dispatch) {
      const tr = state.tr.insert(insertPos, table);
      // Park the cursor inside the first paragraph of the first cell:
      //   insertPos + 1 (into table) + 1 (into row) + 1 (into cell) + 1 (into paragraph)
      const cursorTarget = insertPos + 4;
      tr.setSelection(TextSelection.create(tr.doc, cursorTarget));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function deleteTableCommand(): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === "table") {
        const start = $from.before(depth);
        const end = start + node.nodeSize;
        if (dispatch) dispatch(state.tr.delete(start, end).scrollIntoView());
        return true;
      }
    }
    return false;
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const Table = Extension.create({
  name: "table",

  addNodes() {
    return {
      table: tableSpec(),
      tableRow: tableRowSpec(),
      tableCell: tableCellSpec(),
      tableHeader: tableHeaderSpec(),
    };
  },

  addCommands() {
    return {
      insertTable: (args: unknown) => insertTableCommand(args),
      deleteTable: () => deleteTableCommand(),
    };
  },

  addProseMirrorPlugins() {
    return [tableIntegrityPlugin()];
  },

  addLayoutHandlers() {
    return { tableRow: TableRowStrategy };
  },

  addToolbarItems() {
    return [
      {
        command: "insertTable",
        args: [{ rows: 3, cols: 3 }],
        label: "▦",
        title: "Insert table",
        group: "insert",
        isActive: () => false,
      },
    ];
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        // Phase 1 markdown table is GFM-style: first row becomes the header,
        // each cell is flattened to a single line of text. Multi-block cells,
        // marks, and merged cells (gridSpan / vMerge) are not representable in
        // GFM — they collapse to plain text. Phase 8 is the home of the full
        // serializer (skipping merged cells per `docs/tables.md`).
        table(state, node) {
          const colCount = node.firstChild?.childCount ?? 0;
          if (colCount === 0) {
            state.closeBlock(node);
            return;
          }
          let rowIndex = 0;
          node.forEach((row) => {
            state.write("|");
            row.forEach((cell) => {
              state.write(" ");
              state.write(flattenCellText(cell));
              state.write(" |");
            });
            state.write("\n");
            // Header separator after the first row — GFM requires it for the
            // table to render, even when no header row was authored.
            if (rowIndex === 0) {
              state.write("|");
              for (let i = 0; i < colCount; i++) state.write(" --- |");
              state.write("\n");
            }
            rowIndex++;
          });
          state.closeBlock(node);
        },
        // Defensive fallbacks for partial-fragment serialization (e.g. clipboard
        // slices). The parent `table` handler walks rows/cells directly and
        // never dispatches into these, but a stray fragment that bypasses the
        // table walker would otherwise crash with "token type not supported".
        tableRow(state, node) {
          state.write("| ");
          node.forEach((cell, _, idx) => {
            state.write(flattenCellText(cell));
            state.write(idx < node.childCount - 1 ? " | " : " |");
          });
          state.write("\n");
          state.closeBlock(node);
        },
        tableCell(state, node) {
          state.write(flattenCellText(node));
          state.closeBlock(node);
        },
        tableHeader(state, node) {
          state.write(flattenCellText(node));
          state.closeBlock(node);
        },
      },
    };
  },
});

/**
 * Collapse a tableCell/tableHeader's content to one line of pipe-safe text.
 * GFM cells are inline-only; multi-paragraph cells join with single spaces.
 */
function flattenCellText(cell: Node): string {
  return cell.textContent
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

// Re-exports so consumers can validate attr shapes without re-deriving them.
export { VALID_HALIGNS, VALID_VALIGNS, VALID_VMERGE };

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    table: {
      /** Insert a `rows × cols` table after the current top-level block. */
      insertTable: (args: { rows: number; cols: number }) => ReturnType;
      /** Delete the table containing the current selection, if any. */
      deleteTable: () => ReturnType;
    };
  }
}
