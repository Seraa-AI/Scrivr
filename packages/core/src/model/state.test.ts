import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createEditorState, createEditorStateFromJSON } from "./state";
import { insertText, deleteBackward, toggleBold, applyUndo } from "./commands";

describe("EditorState", () => {
  it("creates an empty document with one paragraph", () => {
    const state = createEditorState();
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.textContent).toBe("");
  });

  it("restores a document from JSON", () => {
    const state = createEditorState();
    const s1 = state.apply(insertText(state, "Hello")!);
    const json = s1.doc.toJSON();
    const restored = createEditorStateFromJSON(json as Record<string, unknown>);
    expect(restored.doc.textContent).toBe("Hello");
  });
});

describe("commands", () => {
  it("insertText adds characters at the cursor position", () => {
    const state = createEditorState();
    const s1 = state.apply(insertText(state, "Hello")!);
    expect(s1.doc.textContent).toBe("Hello");
  });

  it("insertText replaces a selection", () => {
    const state = createEditorState();
    const s1 = state.apply(insertText(state, "Hello world")!);

    // Select "world" — positions inside the paragraph node
    // doc starts at 0, paragraph opens at 1, text "Hello world" is at 1..12
    const sel = TextSelection.create(s1.doc, 7, 12);
    const s2 = s1.apply(s1.tr.setSelection(sel));

    const s3 = s2.apply(insertText(s2, "there")!);
    expect(s3.doc.textContent).toBe("Hello there");
  });

  it("deleteBackward removes the character before the cursor", () => {
    const state = createEditorState();
    const s1 = state.apply(insertText(state, "Hello")!);
    const s2 = s1.apply(deleteBackward(s1)!);
    expect(s2.doc.textContent).toBe("Hell");
  });

  it("deleteBackward returns null at the start of the document", () => {
    const state = createEditorState();
    expect(deleteBackward(state)).toBeNull();
  });

  it("toggleBold returns null when there is no selection", () => {
    const state = createEditorState();
    expect(toggleBold(state)).toBeNull();
  });

  it("undo reverses the last transaction", () => {
    const state = createEditorState();
    const s1 = state.apply(insertText(state, "Hello")!);
    expect(s1.doc.textContent).toBe("Hello");

    const undoTr = applyUndo(s1);
    expect(undoTr).not.toBeNull();
    const s2 = s1.apply(undoTr!);
    expect(s2.doc.textContent).toBe("");
  });
});
