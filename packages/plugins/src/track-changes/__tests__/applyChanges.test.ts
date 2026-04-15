import { describe, it, expect } from "vitest";
import { doc, p, h, TestEditor, schema } from "./helpers";
import { CHANGE_OPERATION } from "../types";

// ── Accept tracked insertions ──────────────────────────────────────────────────

describe("applyChanges — accept tracked insert", () => {
  it("accepting a tracked insert keeps the text and removes the mark", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!"); // trackedInsert for "!"

    const [change] = editor.pendingChanges;
    expect(change!.dataTracked.operation).toBe(CHANGE_OPERATION.insert);

    editor.acceptChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hello!");
  });

  it("accepting one insert out of two leaves the other pending", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!"); // insert 1 (non-adjacent to insert 2)
    editor.insertAt(2, "X"); // insert 2 at a different pos

    expect(editor.pendingChanges).toHaveLength(2);
    const [first] = editor.pendingChanges;

    editor.acceptChanges([first!.id]);

    expect(editor.pendingChanges).toHaveLength(1);
  });
});

// ── Reject tracked insertions ─────────────────────────────────────────────────

describe("applyChanges — reject tracked insert", () => {
  it("rejecting a tracked insert removes the text entirely", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");

    const [change] = editor.pendingChanges;
    editor.rejectChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hello");
  });
});

// ── Accept tracked deletions ───────────────────────────────────────────────────

describe("applyChanges — accept tracked delete", () => {
  it("accepting a tracked delete removes the text from the doc", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(5, 6); // delete "o" — kept in doc with trackedDelete

    expect(editor.text).toBe("hello"); // still visible (pending)

    const [change] = editor.pendingChanges;
    expect(change!.dataTracked.operation).toBe(CHANGE_OPERATION.delete);

    editor.acceptChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hell");
  });
});

// ── Reject tracked deletions ───────────────────────────────────────────────────

describe("applyChanges — reject tracked delete", () => {
  it("rejecting a tracked delete restores the text without the mark", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(5, 6); // delete "o" — kept in doc with trackedDelete

    const [change] = editor.pendingChanges;
    editor.rejectChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hello"); // text stays, mark removed
  });
});

// ── Accept node attr change ────────────────────────────────────────────────────

describe("applyChanges — node-attr-change", () => {
  it("accepting a heading-level change clears the pending mark", () => {
    const editor = new TestEditor(doc(h(1, "hello")));
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.pendingChanges).toHaveLength(1);

    const [change] = editor.pendingChanges;
    editor.acceptChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    // The heading should still be level 2 after accepting
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(2);
  });

  it("rejecting a heading-level change reverts back to original level", () => {
    const editor = new TestEditor(doc(h(1, "hello")));
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    const [change] = editor.pendingChanges;
    editor.rejectChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1);
  });

  it("accepting paragraph→heading change keeps the heading type", () => {
    const editor = new TestEditor(doc(p("hello")));
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    const [change] = editor.pendingChanges;
    editor.acceptChanges([change!.id]);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
  });
});

// ── Undo of accept/reject ─────────────────────────────────────────────────────
//
// Because insert + accept happen synchronously in tests (within the 500ms
// newGroupDelay), ProseMirror groups them into one undo step. Undo therefore
// reverts both — the insert AND the accept — leaving "hello" with no marks.
// This is the correct behavior: undo rolls back the entire editing session.

describe("applyChanges — undo of accept", () => {
  it("undo after accepting a tracked insert reverts both insert and accept", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");

    const [change] = editor.pendingChanges;
    editor.acceptChanges([change!.id]);
    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hello!");

    editor.undo();

    // Both the insert and the accept are in the same history group (same tick),
    // so undo reverts all the way back to the original document.
    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(0);
  });
});
