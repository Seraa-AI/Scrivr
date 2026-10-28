import { describe, it, expect } from "vitest";
import { NodeSelection, TextSelection } from "@scrivr/core/pm";
import { doc, p, schema, TestEditor } from "./helpers";

const bold = schema.marks.bold;
if (!bold) throw new Error("test schema is missing the bold mark");

/**
 * Tracking rewrites the document, so the caret and selection a gesture produced
 * only survive if they are carried across that rewrite. These assert what the
 * person editing sees: the same text stays selected, pointing the same way, and
 * the caret lands where their keystroke left it.
 */

const selected = (editor: TestEditor) => {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to);
};
const direction = (editor: TestEditor) =>
  editor.state.selection.anchor <= editor.state.selection.head ? "forward" : "backward";

/** Types at a caret the way the input bridge does — selection first, then text. */
const type = (editor: TestEditor, at: number, text: string) => {
  editor.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
  );
  return editor.dispatch(editor.state.tr.insertText(text));
};

describe("selection contract — an explicit selection is carried, not collapsed", () => {
  it("keeps a range selecting the same text across a tracked deletion", () => {
    const editor = new TestEditor(doc(p("hello world")));
    const tr = editor.state.tr.delete(1, 7);
    editor.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1, 6)));

    expect(selected(editor)).toBe("world");
    expect(editor.state.selection.empty).toBe(false);
  });

  it("keeps a backward range pointing backward", () => {
    const editor = new TestEditor(doc(p("hello world")));
    const tr = editor.state.tr.delete(1, 7);
    editor.dispatch(tr.setSelection(TextSelection.create(tr.doc, 6, 1)));

    expect(selected(editor)).toBe("world");
    expect(direction(editor)).toBe("backward");
  });

  it("remaps an explicit caret past content the deletion retained", () => {
    const editor = new TestEditor(doc(p("hello world")));
    const tr = editor.state.tr.delete(1, 7);
    editor.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)));

    // "hello " survives wearing a trackedDelete mark, so the caret the command
    // asked for — the start of "world" — is no longer position 1.
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.doc.content.size - 1)).toBe("world");
  });

  it("carries a range that spans the tracked edit", () => {
    const editor = new TestEditor(doc(p("one"), p("two")));
    const tr = editor.state.tr.insertText("!", 4);
    editor.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1, 5)));

    expect(editor.state.selection.empty).toBe(false);
    expect(selected(editor)).toContain("one");
  });

  it("preserves a node selection", () => {
    const editor = new TestEditor(doc(p("one"), p("two")));
    const tr = editor.state.tr.insertText("!", 2);
    editor.dispatch(tr.setSelection(NodeSelection.create(tr.doc, 6)));

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.doc.nodeAt(editor.state.selection.from)?.textContent).toBe("two");
  });
});

describe("selection contract — gestures that restructure without replacing", () => {
  // A wrap or an indent is one ReplaceAroundStep that sets no selection; the
  // caret has to survive it like any other step.
  const wrapInList = (editor: TestEditor, at: number) => {
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
    );
    const tr = editor.state.tr;
    const range = tr.doc.resolve(1).blockRange(tr.doc.resolve(at))!;
    tr.wrap(range, [
      { type: schema.nodes.bullet_list! },
      { type: schema.nodes.list_item! },
    ]);
    return editor.dispatch(tr);
  };

  it("keeps the caret at the end of the text it wrapped", () => {
    const editor = new TestEditor(doc(p("hello")));
    wrapInList(editor, 6);

    expect(editor.state.doc.textBetween(1, editor.state.selection.from, "", "")).toBe("hello");
  });

  // A mid-text caret does not survive precisely: the around-step tracker undoes
  // and restamps the whole block, so the interior position is genuinely gone by
  // the time anything could map it. What must hold is that the caret stays in
  // the text that was wrapped rather than escaping the new list.
  it("leaves the caret inside the text it wrapped", () => {
    const editor = new TestEditor(doc(p("hello")));
    wrapInList(editor, 3);

    const { from } = editor.state.selection;
    const text = editor.state.doc.resolve(from).parent;
    expect(text.textContent).toBe("hello");
    expect(editor.state.doc.textBetween(1, from, "", "").length).toBeLessThanOrEqual(5);
  });
});

describe("selection contract — the caret follows an insertion", () => {
  it("lands after typed text", () => {
    const editor = new TestEditor(doc(p("ab")));
    type(editor, 2, "X");

    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.doc.textBetween(1, editor.state.selection.from)).toBe("aX");
  });

  /** Selects `from..to`, then types over it the way the input bridge does. */
  const typeOver = (editor: TestEditor, from: number, to: number, text: string) => {
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    );
    const { selection } = editor.state;
    return editor.dispatch(editor.state.tr.insertText(text, selection.from, selection.to));
  };
  const typeAtCaret = (editor: TestEditor, text: string) =>
    editor.dispatch(editor.state.tr.insertText(text));

  it("lands after the replacement, not inside the retained deletion", () => {
    const editor = new TestEditor(doc(p("hello world")));
    typeOver(editor, 1, 6, "howdy");

    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.doc.textBetween(1, editor.state.selection.from)).toBe("howdy");
  });

  it("keeps typing after a replacement in one run, before the struck text", () => {
    const editor = new TestEditor(doc(p("hello world")));
    typeOver(editor, 2, 5, "X");
    typeAtCaret(editor, "Y");

    expect(editor.state.doc.textBetween(1, editor.state.selection.from)).toBe("hXY");
    expect(editor.state.doc.textContent).toBe("hXYello world");
  });

  it("leaves a caret alone when the edit landed somewhere else", () => {
    const editor = new TestEditor(doc(p("ab"), p("cd")));
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    );
    editor.dispatch(editor.state.tr.insertText("X", 6));

    expect(editor.state.doc.textBetween(1, editor.state.selection.from)).toBe("a");
  });

  it("never collapses a range the gesture left standing", () => {
    const editor = new TestEditor(doc(p("hello"), p("world")));
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    // Bolding leaves the user's range selection untouched; tracking must not
    // mistake it for a caret that needs moving to an insertion.
    editor.dispatch(
      editor.state.tr.addMark(1, 6, bold.create()),
    );

    expect(editor.state.selection.empty).toBe(false);
    expect(selected(editor)).toBe("hello");
  });
});
