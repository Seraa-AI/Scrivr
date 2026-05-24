import { EditorState, Transaction } from "prosemirror-state";
import { joinBackward, joinForward } from "prosemirror-commands";

/**
 * Commands — pure functions that take a state and return a new transaction.
 *
 * Pattern:
 *   const tr = insertText(state, "Hello")
 *   if (tr) dispatch(tr)
 *
 * Returning null means the command cannot be applied in the current state.
 * This matches the ProseMirror command convention but without prosemirror-view.
 *
 * Scope: this module only holds the low-level *schema-free* editing commands
 * consumed by `InputBridge`, `PasteTransformer`, and the `BaseEditing`
 * extension. Schema-aware commands (toggleBold, setFontSize, undo/redo, …)
 * live with the extension that owns the corresponding node/mark and are
 * surfaced via `addCommands`.
 */

export function insertText(state: EditorState, text: string): Transaction | null {
  const { from, to } = state.selection;
  const tr = state.tr.insertText(text, from, to);
  return tr;
}

export function deleteSelection(state: EditorState): Transaction | null {
  const { empty } = state.selection;
  if (empty) return null;
  return state.tr.deleteSelection();
}

/**
 * Backspace behaviour — matches Google Docs:
 *
 *  - Non-empty selection  → delete it
 *  - Cursor at doc start  → no-op
 *  - Cursor at block start → join with the preceding block (paragraph merge,
 *                            list-item lift, heading collapse, etc.)
 *  - Cursor mid-text       → delete one character to the left
 *
 * Uses ProseMirror's `joinBackward` for block-boundary cases so all the
 * edge cases (different node types, nested lists, etc.) are handled correctly.
 *
 * Signature matches the ProseMirror Command type so it can be used directly
 * as a keymap value without a wrapper.
 */
export function deleteBackward(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { empty, from } = state.selection;

  if (!empty) {
    if (dispatch) dispatch(state.tr.deleteSelection());
    return true;
  }

  if (from <= 1) return false;

  // At the very start of a textblock — join with the previous block
  if (state.selection.$from.parentOffset === 0) {
    return joinBackward(state, dispatch);
  }

  // Mid-text — delete one character to the left
  if (dispatch) dispatch(state.tr.delete(from - 1, from));
  return true;
}

/**
 * Delete key behaviour — mirrors Google Docs:
 *
 *  - Non-empty selection  → delete it
 *  - Cursor at doc end    → no-op
 *  - Cursor at block end  → join with the next block (paragraph merge, etc.)
 *  - Cursor mid-text      → delete one character to the right
 *
 * Signature matches the ProseMirror Command type so it can be used directly
 * as a keymap value without a wrapper.
 */
export function deleteForward(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { empty, from, $from } = state.selection;

  if (!empty) {
    if (dispatch) dispatch(state.tr.deleteSelection());
    return true;
  }

  if (from >= state.doc.content.size) return false;

  // At the very end of a textblock — join with the next block
  if ($from.parentOffset === $from.parent.content.size) {
    return joinForward(state, dispatch);
  }

  // Mid-text — delete one character to the right
  if (dispatch) dispatch(state.tr.delete(from, from + 1));
  return true;
}
