import { describe, it, expect } from "vitest";
import { doc, p, TestEditor, schema } from "./helpers";
import { CHANGE_OPERATION } from "../types";

// ── Enter at end of paragraph ─────────────────────────────────────────────────

describe("enterKey — Enter at end of paragraph", () => {
  it("produces a node_split change on the new paragraph and a reference change on the source", () => {
    const editor = new TestEditor(doc(p("hello")));
    // cursor at pos 6 (end of "hello", inside the paragraph)
    const tr = editor.state.tr.split(6);
    editor.dispatch(tr);

    const pending = editor.pendingChanges;
    expect(pending).toHaveLength(2);

    const ops = pending.map(c => c.dataTracked.operation);
    expect(ops).toContain(CHANGE_OPERATION.node_split);
    expect(ops).toContain("reference");
  });

  it("does not produce any tracked_insert marks on text", () => {
    const editor = new TestEditor(doc(p("hello")));
    const tr = editor.state.tr.split(6);
    editor.dispatch(tr);

    // Walk all text nodes — none should have tracked_insert
    let foundInsertMark = false;
    editor.state.doc.descendants(node => {
      if (node.isText && node.marks.some(m => m.type === schema.marks.tracked_insert)) {
        foundInsertMark = true;
      }
    });
    expect(foundInsertMark).toBe(false);
  });

  it("text content is correct: source paragraph has 'hello', new paragraph is empty", () => {
    const editor = new TestEditor(doc(p("hello")));
    const tr = editor.state.tr.split(6);
    editor.dispatch(tr);

    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).textContent).toBe("hello");
    expect(editor.state.doc.child(1).textContent).toBe("");
  });
});

// ── Enter in the middle of a paragraph ────────────────────────────────────────

describe("enterKey — Enter in the middle of 'hel|lo'", () => {
  it("produces node_split + reference changes; 'lo' has no tracked_insert marks", () => {
    const editor = new TestEditor(doc(p("hello")));
    // Split between "hel" and "lo": pos 4 (1 doc open + 3 chars)
    const tr = editor.state.tr.split(4);
    editor.dispatch(tr);

    const pending = editor.pendingChanges;
    expect(pending).toHaveLength(2);
    expect(pending.map(c => c.dataTracked.operation)).toContain(CHANGE_OPERATION.node_split);
    expect(pending.map(c => c.dataTracked.operation)).toContain("reference");

    // "lo" in the new paragraph must NOT carry a tracked_insert mark
    let foundInsertMark = false;
    editor.state.doc.descendants(node => {
      if (node.isText && node.marks.some(m => m.type === schema.marks.tracked_insert)) {
        foundInsertMark = true;
      }
    });
    expect(foundInsertMark).toBe(false);
  });

  it("both paragraphs are visible in the document", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(4));

    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).textContent).toBe("hel");
    expect(editor.state.doc.child(1).textContent).toBe("lo");
  });

  it("source paragraph has reference operation, not insert or delete", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(4));

    const pending = editor.pendingChanges;
    const ref = pending.find(c => c.dataTracked.operation === "reference")!;
    expect(ref).toBeDefined();
    expect(ref.dataTracked.operation).toBe("reference");
    expect(ref.dataTracked.operation).not.toBe(CHANGE_OPERATION.insert);
    expect(ref.dataTracked.operation).not.toBe(CHANGE_OPERATION.delete);
  });
});

// ── Accept the node_split ─────────────────────────────────────────────────────

describe("enterKey — accept", () => {
  it("accepting clears all pending changes; both paragraphs remain", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(4)); // "hel" | "lo"

    const ids = editor.pendingChanges.map(c => c.id);
    editor.acceptChanges(ids);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).textContent).toBe("hel");
    expect(editor.state.doc.child(1).textContent).toBe("lo");
  });
});

// ── Reject the node_split ─────────────────────────────────────────────────────

describe("enterKey — reject", () => {
  it("rejecting the node_split restores the original paragraph ('hello')", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(4)); // "hel" | "lo"

    // Reject the node_split change (not the reference — revertSplitNodeChange
    // handles both when given the node_split id)
    const splitChange = editor.pendingChanges.find(
      c => c.dataTracked.operation === CHANGE_OPERATION.node_split,
    )!;
    editor.rejectChanges([splitChange.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("hello");
  });

  it("rejecting Enter at end of paragraph removes the new empty paragraph", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(6)); // "hello" | ""

    const splitChange = editor.pendingChanges.find(
      c => c.dataTracked.operation === CHANGE_OPERATION.node_split,
    )!;
    editor.rejectChanges([splitChange.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("hello");
  });
});

// ── Text typed after Enter is still tracked ───────────────────────────────────

describe("enterKey — text typed after Enter is tracked", () => {
  it("text inserted into the new paragraph after Enter has tracked_insert marks", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(6)); // new empty paragraph

    // Type " world" into the new paragraph (pos 8 = inside second paragraph)
    editor.insertAt(8, "world");

    const insertChanges = editor.pendingChanges.filter(
      c => c.dataTracked.operation === CHANGE_OPERATION.insert,
    );
    expect(insertChanges.length).toBeGreaterThan(0);
  });
});

// ── Undo after Enter ──────────────────────────────────────────────────────────

describe("enterKey — undo", () => {
  it("undo after Enter fully reverts to the original single paragraph", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.split(4));

    expect(editor.state.doc.childCount).toBe(2);

    editor.undo();

    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).textContent).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(0);
  });
});
