import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "./schema";
import {
  insertText,
  deleteSelection,
  deleteBackward,
  deleteForward,
  splitBlock,
  applyUndo,
  applyRedo,
} from "./commands";
import { history } from "prosemirror-history";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(text = ""): EditorState {
  const plugins = [history()];
  const state = EditorState.create({ schema, plugins });
  if (!text) return state;
  // Insert text at the start
  const tr = insertText(state, text)!;
  return state.apply(tr);
}

function stateWithSelection(text: string, from: number, to: number): EditorState {
  const base = makeState(text);
  const $from = base.doc.resolve(from);
  const $to = base.doc.resolve(to);
  const { TextSelection } = require("prosemirror-state");
  return base.apply(base.tr.setSelection(TextSelection.between($from, $to)));
}

// ── insertText ────────────────────────────────────────────────────────────────

describe("insertText", () => {
  it("inserts text at the cursor position", () => {
    const state = makeState();
    const tr = insertText(state, "hello");
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe("hello");
  });

  it("replaces a range selection with the inserted text", () => {
    const state = makeState("hello");
    // Select "ello" (positions 2–6 inside the paragraph node)
    const sel = stateWithSelection("hello", 2, 6);
    const tr = insertText(sel, "i");
    expect(tr).not.toBeNull();
    const next = sel.apply(tr!);
    expect(next.doc.textContent).toBe("hi");
  });
});

// ── deleteSelection ───────────────────────────────────────────────────────────

describe("deleteSelection", () => {
  it("returns null when selection is collapsed", () => {
    const state = makeState("hello");
    expect(deleteSelection(state)).toBeNull();
  });

  it("deletes the selected range", () => {
    const sel = stateWithSelection("hello", 2, 4);
    const tr = deleteSelection(sel);
    expect(tr).not.toBeNull();
    const next = sel.apply(tr!);
    expect(next.doc.textContent).toBe("hlo");
  });
});

// ── deleteBackward ────────────────────────────────────────────────────────────

function applyBackward(state: EditorState): EditorState | null {
  let dispatched: ReturnType<typeof state.apply> | null = null;
  const handled = deleteBackward(state, (tr) => { dispatched = state.apply(tr); });
  return handled ? dispatched : null;
}

describe("deleteBackward", () => {
  it("returns false at the start of the document (no-op)", () => {
    const state = makeState();
    expect(deleteBackward(state)).toBe(false);
  });

  it("deletes one character to the left (mid-text)", () => {
    const state = makeState("abc");
    const next = applyBackward(state);
    expect(next?.doc.textContent).toBe("ab");
  });

  it("deletes the selection when non-empty", () => {
    const sel = stateWithSelection("hello", 2, 4);
    const next = applyBackward(sel);
    expect(next?.doc.textContent).toBe("hlo");
  });

  it("joins two paragraphs when cursor is at the start of the second one", () => {
    // Build: <p>Hello</p><p>World</p>, cursor at start of "World"
    const s1 = makeState("Hello");
    const s2 = s1.apply(splitBlock(s1)!);
    const s3 = s2.apply(insertText(s2, "World")!);

    // cursor is after "World" — move it to the start of the second paragraph
    const { TextSelection } = require("prosemirror-state");
    // <p>Hello</p> occupies positions 0-6 (nodeSize=7); second <p> opens at 7, inside at 8
    const s4 = s3.apply(s3.tr.setSelection(TextSelection.near(s3.doc.resolve(8))));

    const next = applyBackward(s4);
    expect(next?.doc.textContent).toBe("HelloWorld");
    expect(next?.doc.childCount).toBe(1); // merged into one paragraph
  });

  it("joins an empty paragraph into the preceding one", () => {
    // <p>Hello</p><p></p>, cursor at start of empty paragraph
    const s1 = makeState("Hello");
    const s2 = s1.apply(splitBlock(s1)!);
    // cursor is already inside the new empty paragraph
    const next = applyBackward(s2);
    expect(next?.doc.childCount).toBe(1);
    expect(next?.doc.textContent).toBe("Hello");
  });
});

// ── deleteForward ─────────────────────────────────────────────────────────────

function applyForward(state: EditorState): EditorState | null {
  let dispatched: ReturnType<typeof state.apply> | null = null;
  const handled = deleteForward(state, (tr) => { dispatched = state.apply(tr); });
  return handled ? dispatched : null;
}

describe("deleteForward", () => {
  it("returns false at the end of the document (no-op)", () => {
    const state = makeState("abc");
    expect(deleteForward(state)).toBe(false);
  });

  it("deletes one character ahead of the cursor", () => {
    const state = makeState("abc");
    // Move cursor to after the paragraph open token (position 1)
    const { TextSelection } = require("prosemirror-state");
    const $pos = state.doc.resolve(1);
    const withCursor = state.apply(state.tr.setSelection(TextSelection.near($pos)));
    const next = applyForward(withCursor);
    expect(next?.doc.textContent).toBe("bc");
  });

  it("deletes the selection when non-empty", () => {
    const sel = stateWithSelection("hello", 2, 4);
    const next = applyForward(sel);
    expect(next?.doc.textContent).toBe("hlo");
  });

  it("joins two paragraphs when cursor is at the end of the first one", () => {
    // Build: <p>Hello</p><p>World</p>, cursor at end of "Hello"
    const s1 = makeState("Hello");
    const s2 = s1.apply(splitBlock(s1)!);
    const s3 = s2.apply(insertText(s2, "World")!);

    // Move cursor to the end of the first paragraph: position 6
    const { TextSelection } = require("prosemirror-state");
    const s4 = s3.apply(s3.tr.setSelection(TextSelection.near(s3.doc.resolve(6))));

    const next = applyForward(s4);
    expect(next?.doc.textContent).toBe("HelloWorld");
    expect(next?.doc.childCount).toBe(1);
  });
});

// ── splitBlock ────────────────────────────────────────────────────────────────

describe("splitBlock", () => {
  it("splits the current paragraph into two", () => {
    const state = makeState("hello");
    // Move cursor to middle of "hello" — after "he" = position 3
    const { TextSelection } = require("prosemirror-state");
    const $pos = state.doc.resolve(3);
    const withCursor = state.apply(state.tr.setSelection(TextSelection.near($pos)));
    const tr = splitBlock(withCursor);
    expect(tr).not.toBeNull();
    const next = withCursor.apply(tr!);
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).textContent).toBe("he");
    expect(next.doc.child(1).textContent).toBe("llo");
  });
});

// ── applyUndo / applyRedo ─────────────────────────────────────────────────────

describe("applyUndo", () => {
  it("returns null when there is nothing to undo", () => {
    const state = makeState();
    expect(applyUndo(state)).toBeNull();
  });

  it("undoes the last change", () => {
    const state = makeState("hello");
    const undoTr = applyUndo(state);
    expect(undoTr).not.toBeNull();
    const undone = state.apply(undoTr!);
    expect(undone.doc.textContent).toBe("");
  });
});

describe("applyRedo", () => {
  it("returns null when there is nothing to redo", () => {
    const state = makeState("hello");
    expect(applyRedo(state)).toBeNull();
  });

  it("redoes after an undo", () => {
    const state = makeState("hello");
    const undone = state.apply(applyUndo(state)!);
    const redoTr = applyRedo(undone);
    expect(redoTr).not.toBeNull();
    const redone = undone.apply(redoTr!);
    expect(redone.doc.textContent).toBe("hello");
  });
});
