import { EditorState, Transaction } from "prosemirror-state";
import { toggleMark } from "prosemirror-commands";
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

export function deleteBackward(state: EditorState): Transaction | null {
  const { empty, from } = state.selection;
  if (!empty) return state.tr.deleteSelection();
  if (from <= 1) return null; // already at start of doc
  return state.tr.delete(from - 1, from);
}

export function deleteForward(state: EditorState): Transaction | null {
  const { empty, from } = state.selection;
  if (!empty) return state.tr.deleteSelection();
  if (from >= state.doc.content.size) return null;
  return state.tr.delete(from, from + 1);
}

export function splitBlock(state: EditorState): Transaction | null {
  return state.tr.split(state.selection.from);
}

// ── Formatting ───────────────────────────────────────────────────────────────

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
  return state.tr.addMark(from, to, schema.marks["font_size"]!.create({ size }));
}

export function setFontFamily(state: EditorState, family: string): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  return state.tr.addMark(from, to, schema.marks["font_family"]!.create({ family }));
}

export function setColor(state: EditorState, color: string): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  return state.tr.addMark(from, to, schema.marks["color"]!.create({ color }));
}

// ── History ──────────────────────────────────────────────────────────────────

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

// ── Internal helpers ─────────────────────────────────────────────────────────

function applyToggleMark(state: EditorState, markType: MarkType): Transaction | null {
  const { from, to } = state.selection;
  const tr = state.tr;
  toggleMark(markType)(state, (t: Transaction) => { tr.steps.push(...t.steps); });
  if (!tr.docChanged && from === to) return null;
  return tr;
}
