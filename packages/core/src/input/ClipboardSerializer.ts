import { DOMSerializer } from "prosemirror-model";
import type { Schema, Slice } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { CellSelection } from "../table/cellSelection";
import { collapseRowSpans } from "../table/clipboardHtml";

/**
 * Records how deeply the copied slice was open at each end, so a paste back into
 * an editor can rebuild the exact slice instead of guessing from tag shape.
 * Without it, HTML alone cannot distinguish "half a paragraph" from "a whole
 * paragraph" — both serialize to the same markup.
 *
 * The `openStart openEnd context` triple is ProseMirror's own clipboard
 * convention, so slices also round-trip with other ProseMirror-based editors.
 * The context field is always empty here: the full open path is serialized
 * rather than unwrapped, so there is no stripped ancestry to describe.
 */
export const SLICE_DATA_ATTR = "data-pm-slice";

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
  const slice = sel.content();
  const container = document.createElement("div");
  container.setAttribute(
    SLICE_DATA_ATTR,
    `${slice.openStart} ${slice.openEnd} []`,
  );
  container.appendChild(serializer.serializeFragment(slice.content));
  // Any table in the slice states its merges as attrs; the clipboard states
  // them as `rowspan`, which is what another editor will read.
  collapseRowSpans(container);
  return container.outerHTML;
}

/**
 * Serialize a rectangular cell slice as a standalone table. The cells carry
 * their merge role as an attr, which `collapseRowSpans` turns into the
 * `rowspan` other editors read.
 */
function serializeCellSelectionToHtml(
  selection: CellSelection,
  serializer: DOMSerializer,
): string {
  const tableNode = selection.content().content.firstChild;
  if (!tableNode || tableNode.type.name !== "table") return "";

  const container = document.createElement("div");
  container.appendChild(serializer.serializeNode(tableNode));
  collapseRowSpans(container);
  return container.innerHTML;
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
