import { EditorState, Transaction } from "prosemirror-state";
import { toggleMark, joinBackward, joinForward } from "prosemirror-commands";
import { MarkType } from "prosemirror-model";
import { undo, redo } from "prosemirror-history";
import { schema } from "./schema";

/**
 * Commands — pure functions that take a state and return a new transaction.
 *
 * Pattern:
 *   const tr = insertText(state, "Hello")
 *   if (tr) dispatch(tr)
 *
 * Returning null means the command cannot be applied in the current state.
 * This matches the ProseMirror command convention but without prosemirror-view.
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

export function splitBlock(state: EditorState): Transaction | null {
  return state.tr.split(state.selection.from);
}

/** Formatting */

export function toggleBold(state: EditorState): Transaction | null {
  return applyToggleMark(state, schema.marks["bold"]!);
}

export function toggleItalic(state: EditorState): Transaction | null {
  return applyToggleMark(state, schema.marks["italic"]!);
}

export function toggleUnderline(state: EditorState): Transaction | null {
  return applyToggleMark(state, schema.marks["underline"]!);
}

export function toggleStrikethrough(state: EditorState): Transaction | null {
  return applyToggleMark(state, schema.marks["strikethrough"]!);
}

export function setFontSize(state: EditorState, size: number): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  return state.tr.addMark(from, to, schema.marks["fontSize"]!.create({ size }));
}

export function setFontFamily(state: EditorState, family: string): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  return state.tr.addMark(from, to, schema.marks["fontFamily"]!.create({ family }));
}

export function setColor(state: EditorState, color: string): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  return state.tr.addMark(from, to, schema.marks["color"]!.create({ color }));
}

/** History */

/**
 * Undo / redo use prosemirror-history's command interface.
 * They need a dispatch function to work — wrap them here for consistency.
 */
export function applyUndo(state: EditorState): Transaction | null {
  let result: Transaction | null = null;
  undo(state, (tr) => { result = tr; });
  return result;
}

export function applyRedo(state: EditorState): Transaction | null {
  let result: Transaction | null = null;
  redo(state, (tr) => { result = tr; });
  return result;
}

/** Internal helpers */

function applyToggleMark(state: EditorState, markType: MarkType): Transaction | null {
  const { from, to } = state.selection;
  const tr = state.tr;
  toggleMark(markType)(state, (t: Transaction) => { tr.steps.push(...t.steps); });
  if (!tr.docChanged && from === to) return null;
  return tr;
}
