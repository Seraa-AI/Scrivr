import { DOMSerializer } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { selectedCells } from "../table/cellSelection";

/**
 * ClipboardSerializer — converts the current PM selection to an HTML string.
 *
 * Uses ProseMirror's DOMSerializer which delegates to each node/mark's `toDOM`
 * spec, so bold, italic, font size, font family, heading levels, alignment, etc.
 * are all serialized automatically without any custom HTML generation.
 *
 * The resulting HTML is written to `text/html` on the clipboard so that paste
 * into Word, Google Docs, Notion, etc. preserves full formatting.
 *
 * Returns null when the selection is collapsed (nothing to copy).
 */
export function serializeSelectionToHtml(
  state: EditorState,
  schema: Schema,
): string | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;

  const slice = state.doc.slice(from, to);
  const serializer = DOMSerializer.fromSchema(schema);
  const container = document.createElement("div");
  container.appendChild(serializer.serializeFragment(slice.content));
  return container.innerHTML;
}

/**
 * Serialize a table cell-range selection to clipboard payloads. A drag-selected
 * cell range lives in plugin state with a collapsed PM caret, so the normal
 * selection path sees "nothing to copy" — this reconstructs the selected
 * rectangle as an HTML `<table>` (paste into Docs/Word/Notion keeps the grid)
 * plus tab/newline text. Returns null when there is no active cell range.
 *
 * `normalizeRect` guarantees the range holds whole merged cells, so a merged
 * cell is emitted once at its top-left with `colspan`/`rowspan`; the grid slots
 * it also covers are skipped.
 */
export function serializeCellSelection(
  state: EditorState,
  schema: Schema,
): { text: string; html: string } | null {
  const sel = selectedCells(state);
  if (!sel) return null;

  const { map, rect, tableStart } = sel;
  const serializer = DOMSerializer.fromSchema(schema);
  const textRows: string[] = [];
  const htmlRows: string[] = [];

  for (let r = rect.top; r < rect.bottom; r++) {
    const textCells: string[] = [];
    const htmlCells: string[] = [];
    for (let c = rect.left; c < rect.right; c++) {
      const offset = map.map[r * map.width + c];
      if (offset == null || offset < 0) continue;
      const cellRect = map.findCell(offset);
      // A merged cell appears in several grid slots — emit it only at its
      // top-left corner within the range, skip its continuation slots.
      if (cellRect.top < r || cellRect.left < c) continue;
      const cellNode = state.doc.nodeAt(tableStart + offset);
      if (!cellNode) continue;

      const colspan = Math.min(cellRect.right, rect.right) - c;
      const rowspan = Math.min(cellRect.bottom, rect.bottom) - r;
      const div = document.createElement("div");
      div.appendChild(serializer.serializeFragment(cellNode.content));
      const tag = cellNode.type.name === "tableHeader" ? "th" : "td";
      const span =
        (colspan > 1 ? ` colspan="${colspan}"` : "") +
        (rowspan > 1 ? ` rowspan="${rowspan}"` : "");
      htmlCells.push(`<${tag}${span}>${div.innerHTML}</${tag}>`);
      textCells.push(cellNode.textContent);
    }
    if (htmlCells.length) htmlRows.push(`<tr>${htmlCells.join("")}</tr>`);
    textRows.push(textCells.join("\t"));
  }

  if (!htmlRows.length) return null;
  return {
    text: textRows.join("\n"),
    html: `<table><tbody>${htmlRows.join("")}</tbody></table>`,
  };
}
