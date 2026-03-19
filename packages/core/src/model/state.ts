import { EditorState } from "prosemirror-state";
import { history } from "prosemirror-history";
import { schema } from "./schema";

export type { EditorState };

/**
 * Creates a fresh EditorState with an empty document.
 *
 * This is the starting point for every editor instance.
 * The state is immutable — every edit produces a new state via a Transaction.
 */
export function createEditorState(): EditorState {
  return EditorState.create({
    schema,
    plugins: [
      history(), // undo/redo via prosemirror-history
    ],
  });
}

/**
 * Creates an EditorState from a JSON document.
 *
 * Use this to restore a saved document.
 * The JSON shape is whatever prosemirror-model produces via doc.toJSON().
 */
export function createEditorStateFromJSON(json: Record<string, unknown>): EditorState {
  const doc = schema.nodeFromJSON(json);
  return EditorState.create({
    schema,
    doc,
    plugins: [history()],
  });
}
