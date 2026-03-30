import { DOMSerializer } from "prosemirror-model";
import type { Schema } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";

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
