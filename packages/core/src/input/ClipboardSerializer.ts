import { DOMSerializer } from "prosemirror-model";
import type { Schema, Slice } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { CellSelection } from "../table/cellSelection";
import { getTableMap } from "../table/TableMap";

/**
 * ClipboardSerializer — converts the current PM selection to clipboard payloads.
 *
 * Both the HTML and text forms read `state.selection.content()`, so every
 * selection kind serializes through one path: a text range yields its doc slice,
 * a `CellSelection` yields a standalone table slice. HTML uses ProseMirror's
 * `DOMSerializer` (each node/mark's `toDOM`), so marks, headings, alignment,
 * etc. round-trip into Word / Google Docs / Notion automatically.
 *
 * Returns null when the selection is collapsed (nothing to copy).
 */
export function serializeSelectionToHtml(
  state: EditorState,
  schema: Schema,
): string | null {
  const sel = state.selection;
  if (sel.empty) return null;

  const serializer = DOMSerializer.fromSchema(schema);
  if (sel instanceof CellSelection) {
    return serializeCellSelectionToHtml(sel, serializer);
  }
  const container = document.createElement("div");
  container.appendChild(serializer.serializeFragment(sel.content().content));
  return container.innerHTML;
}

/**
 * Serialize a rectangular cell slice with explicit span attributes. Table
 * nodes deliberately have a minimal `toDOM`, and a cell's `rowspan` is derived
 * from the table map rather than stored on that node, so the generic serializer
 * cannot preserve merged-cell structure by itself.
 */
function serializeCellSelectionToHtml(
  selection: CellSelection,
  serializer: DOMSerializer,
): string {
  const tableNode = selection.content().content.firstChild;
  if (!tableNode || tableNode.type.name !== "table") return "";

  const map = getTableMap(tableNode);
  const table = document.createElement("table");
  const body = document.createElement("tbody");
  table.appendChild(body);

  for (let row = 0; row < map.height; row++) {
    const tr = document.createElement("tr");
    for (let col = 0; col < map.width; col++) {
      const offset = map.map[row * map.width + col];
      if (offset == null || offset < 0) continue;
      const rect = map.findCell(offset);
      // A merged cell occupies multiple grid slots; emit its master once.
      if (rect.top !== row || rect.left !== col) continue;
      const cellNode = tableNode.nodeAt(offset);
      if (!cellNode) continue;

      const cell = document.createElement(cellNode.type.name === "tableHeader" ? "th" : "td");
      const colspan = rect.right - rect.left;
      const rowspan = rect.bottom - rect.top;
      if (colspan > 1) cell.setAttribute("colspan", String(colspan));
      if (rowspan > 1) cell.setAttribute("rowspan", String(rowspan));
      cell.appendChild(serializer.serializeFragment(cellNode.content));
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }

  return table.outerHTML;
}

/**
 * Plain-text (`text/plain`) form of the current selection. A cell selection is
 * emitted as tab-separated columns / newline-separated rows (the spreadsheet
 * convention); any other selection uses the document text with block breaks.
 */
export function serializeSelectionToText(state: EditorState): string | null {
  const sel = state.selection;
  if (sel.empty) return null;
  if (sel instanceof CellSelection) return cellSliceToText(sel.content());
  return state.doc.textBetween(sel.from, sel.to, "\n");
}

/** Flatten a `CellSelection` table slice to tab/newline text. */
function cellSliceToText(slice: Slice): string {
  const table = slice.content.firstChild;
  if (!table) return "";
  const rows: string[] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells.join("\t"));
  });
  return rows.join("\n");
}
