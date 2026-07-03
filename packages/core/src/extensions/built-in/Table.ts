import { Extension } from "../Extension";
import { TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Node, NodeSpec, Schema } from "prosemirror-model";
import type { IEditor, OverlayRenderHandler } from "../types";
import { TableRowStrategy } from "../../renderer/TableRowStrategy";
import { tableIntegrityPlugin } from "../../table/normalize";
import {
  tabToNextCell,
  tabToPreviousCell,
  guardBackspace,
  guardDelete,
} from "../../table/editingGuards";
import { tableStructureCommands } from "../../table/commands";
import { cellSelectionPlugin, selectedCells } from "../../table/cellSelection";
import { renderTableRowPdf } from "../../table/pdfExport";
import { tableDocxHandlers } from "../../table/docxExport";

/**
 * Table extension.
 *
 * What lands now:
 *   - Word-shaped schema for `table` / `tableRow` / `tableCell` / `tableHeader`.
 *   - `insertTable({ rows, cols })` / `deleteTable()` + row/column structural
 *     commands and cell navigation.
 *   - Real canvas cell layout + rendering (TableRowStrategy) and PDF/DOCX parity.
 *   - PageLayout dispatches each row as an atomic block (whole-row pagination).
 *   - `tableIntegrityPlugin()` — document-validity normalization on every
 *     doc-changing transaction (grid/gridSpan/vMerge repair, row padding).
 *   - `tableEditingGuards()` — editing-UX layer: Tab/Shift-Tab cell navigation
 *     (Tab past the last cell appends a row), Backspace/Delete cell-boundary
 *     guards, and paste distribution into a multi-cell selection.
 *
 * What is intentionally deferred:
 *   - Persisted cell selection (drag-select + overlay) and merge/split — Phase 6.
 *     Cross-cell selection is currently derived from a spanning text selection.
 *   - HTML paste round-trip (Phase 7), Markdown export (Phase 8).
 */

const DEFAULT_COLUMN_WIDTH = 100; // CSS px — uniform default; resizing arrives in Phase 9.

const VALID_HALIGNS = ["left", "center", "right", "justify"] as const;
const VALID_VALIGNS = ["top", "center", "bottom"] as const;
const VALID_VMERGE = ["none", "restart", "continue"] as const;

function uniformGrid(cols: number): number[] {
  return Array.from({ length: cols }, () => DEFAULT_COLUMN_WIDTH);
}

/** Read the persisted block id off a parsed DOM node (see model/assignBlockIds). */
function parseNodeId(dom: HTMLElement | string): { nodeId: string | null } {
  const el = dom as HTMLElement;
  return { nodeId: el.getAttribute("data-node-id") ?? null };
}

/** Emit `data-node-id` when the node carries one, so the id survives serialize. */
function nodeIdAttrs(node: Node): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
  return attrs;
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
      nodeId: { default: null },
    },
    parseDOM: [{ tag: "table", getAttrs: parseNodeId }],
    toDOM(node) {
      // Phase 1 keeps DOM serialization minimal — the canvas renderer is
      // authoritative. HTML paste round-trip lands in Phase 7.
      return ["table", nodeIdAttrs(node), ["tbody", 0]];
    },
  };
}

function tableRowSpec(): NodeSpec {
  return {
    content: "(tableCell | tableHeader)+",
    attrs: {
      repeatHeader: { default: false },
      allowBreakAcrossPages: { default: false },
      nodeId: { default: null },
    },
    parseDOM: [{ tag: "tr", getAttrs: parseNodeId }],
    toDOM(node) {
      return ["tr", nodeIdAttrs(node), 0];
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
    nodeId: { default: null },
  };
}

function tableCellSpec(): NodeSpec {
  return {
    content: "block+",
    isolating: true,
    attrs: cellAttrs(),
    parseDOM: [{ tag: "td", getAttrs: parseNodeId }],
    toDOM(node) {
      return ["td", nodeIdAttrs(node), 0];
    },
  };
}

function tableHeaderSpec(): NodeSpec {
  return {
    content: "block+",
    isolating: true,
    attrs: cellAttrs(),
    parseDOM: [{ tag: "th", getAttrs: parseNodeId }],
    toDOM(node) {
      return ["th", nodeIdAttrs(node), 0];
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
      insertTable: (args) => insertTableCommand(args),
      deleteTable: () => deleteTableCommand(),
      ...tableStructureCommands(),
    };
  },

  addKeymap() {
    // The canvas InputBridge dispatches keys through the merged extension keymap
    // (addKeymap), never through ProseMirror plugin handleKeyDown props — so cell
    // editing keys live here. StarterKit chains these with the base Backspace/
    // Delete and the List/CodeBlock Tab handlers (a guard returns false when it
    // doesn't apply, so the chain falls through).
    return {
      Tab: tabToNextCell,
      "Shift-Tab": tabToPreviousCell,
      Backspace: guardBackspace,
      Delete: guardDelete,
    };
  },

  addProseMirrorPlugins() {
    // cellSelectionPlugin holds the persisted drag-select range; tableIntegrityPlugin
    // runs last so it repairs any structural drift a range-consuming command produced.
    return [cellSelectionPlugin(), tableIntegrityPlugin()];
  },

  onViewReady(editor: IEditor) {
    // Paint the active cell selection: fill each selected cell's rect on its
    // page. Cell rects come from the Phase 4 layout (cell.x absolute, cell.y
    // relative to the row block top). Selection is view state — nothing is
    // written to the document.
    const handler: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, _charMap, theme) => {
      const sel = selectedCells(editor.getState());
      if (!sel) return;
      const page = editor.layout.pages.find((p) => p.pageNumber === pageNumber);
      if (!page) return;

      const selected = new Set(sel.cellPositions);
      ctx.save();
      ctx.fillStyle = theme.selectionFill;
      for (const block of page.blocks) {
        if (block.kind !== "tableRow" || !block.cells) continue;
        for (const c of block.cells) {
          if (selected.has(c.cellPos)) ctx.fillRect(c.x, block.y + c.y, c.width, c.height);
        }
      }
      ctx.restore();
    };
    return editor.addOverlayRenderHandler(handler);
  },

  addBlockStyles() {
    // Rows carry no spacing so they stack flush into one grid; row height is
    // content-driven by the layout engine, so the font here is irrelevant.
    return {
      tableRow: { font: "14px", spaceBefore: 0, spaceAfter: 0, align: "left" as const },
    };
  },

  addExports() {
    // PDF parity for canvas-rendered table rows. Registered on the extension
    // (not in @scrivr/export-pdf defaults) using the structural-context pattern
    // so core stays free of pdf-lib. DOCX parity ships the same way — the
    // walker dispatches table/tableRow/tableCell/tableHeader through these.
    return {
      pdf: { nodes: { tableRow: renderTableRowPdf } },
      docx: { nodes: tableDocxHandlers },
    };
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
      /** Insert an empty row above the row holding the selection. */
      addRowBefore: () => ReturnType;
      /** Insert an empty row below the row holding the selection. */
      addRowAfter: () => ReturnType;
      /** Delete the row holding the selection (or the table, if it was the last row). */
      deleteRow: () => ReturnType;
      /** Insert an empty column to the left of the selected cell. */
      addColumnBefore: () => ReturnType;
      /** Insert an empty column to the right of the selected cell. */
      addColumnAfter: () => ReturnType;
      /** Delete the column holding the selection (or the table, if it was the last column). */
      deleteColumn: () => ReturnType;
      /** Move the selection to the next cell in document order. */
      goToNextCell: () => ReturnType;
      /** Move the selection to the previous cell in document order. */
      goToPreviousCell: () => ReturnType;
    };
  }
}
