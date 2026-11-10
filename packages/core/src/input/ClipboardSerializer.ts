import { DOMSerializer } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { EditorState, Selection } from "prosemirror-state";
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
 * a selection that writes its own forms (a cell selection writes a table) is
 * asked for them. HTML uses ProseMirror's
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
  const own = ownClipboardForms(sel);
  if (own) return own.html(serializer);
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

/** A selection's own clipboard forms, when it writes them: a cell selection writes a table. */
function ownClipboardForms(sel: Selection): { html(serializer: DOMSerializer): string; text(): string } | null {
  if (!("clipboardHtml" in sel) || typeof sel.clipboardHtml !== "function") return null;
  if (!("clipboardText" in sel) || typeof sel.clipboardText !== "function") return null;
  const { clipboardHtml, clipboardText } = sel;
  return {
    html: (serializer) => String(clipboardHtml.call(sel, serializer)),
    text: () => String(clipboardText.call(sel)),
  };
}

/**
 * Plain-text (`text/plain`) form of the current selection: its own, when it
 * writes one (a cell selection writes tab-separated columns), or the document
 * text with block breaks.
 */
export function serializeSelectionToText(state: EditorState): string | null {
  const sel = state.selection;
  if (sel.empty) return null;
  const own = ownClipboardForms(sel);
  if (own) return own.text();
  return state.doc.textBetween(sel.from, sel.to, "\n");
}
