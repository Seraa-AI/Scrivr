import { describe, it, expect, beforeEach } from "vitest";
import { doc, p, h, TestEditor } from "./helpers";
import { CHANGE_OPERATION } from "../types";

// ── Undo / redo in suggestion mode ────────────────────────────────────────────
//
// Core invariant: a single Ctrl+Z should fully revert the user's intent —
// both the tracked mark AND the underlying content change — atomically.
// The track-changes plugin returns its tracking transaction from
// appendTransaction in the same tick, so ProseMirror's history groups them
// into one entry.

describe("undo/redo — text deletion", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor(doc(p("hello")));
  });

  it("deleting a character marks it as tracked_delete (not removed from doc)", () => {
    editor.deleteRange(5, 6); // delete "o"

    expect(editor.text).toBe("hello"); // "o" still present in doc (tracked)
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.delete);
  });

  it("undo after delete fully reverts: no tracked marks, doc unchanged", () => {
    editor.deleteRange(5, 6);
    editor.undo();

    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(0);
  });

  it("redo after undo re-applies the tracked deletion", () => {
    editor.deleteRange(5, 6);
    editor.undo();
    editor.redo();

    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.delete);
  });

  it("multiple undos work independently for separate deletions", () => {
    // Use non-adjacent chars ("h" at 1 and "o" at 5) so they stay as separate
    // marks — adjacent same-author deletions are correctly merged into one.
    editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(5, 6); // delete "o" → first tracked_delete
    editor.deleteRange(2, 3); // delete "e" (non-adjacent) → second tracked_delete

    expect(editor.pendingChanges).toHaveLength(2);

    editor.undo(); // undo second deletion ("e")
    expect(editor.pendingChanges).toHaveLength(1);

    editor.undo(); // undo first deletion ("o")
    expect(editor.pendingChanges).toHaveLength(0);
  });
});

describe("undo/redo — text insertion", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor(doc(p("hello")));
  });

  it("inserting text marks it as tracked_insert", () => {
    editor.insertAt(6, " world"); // after "hello" inside paragraph

    expect(editor.text).toBe("hello world");
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.insert);
  });

  it("undo after insert fully reverts: no tracked marks, original text restored", () => {
    editor.insertAt(6, " world");
    editor.undo();

    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(0);
  });

  it("redo after undo re-applies the tracked insertion", () => {
    editor.insertAt(6, " world");
    editor.undo();
    editor.redo();

    expect(editor.text).toBe("hello world");
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.insert);
  });
});

describe("undo/redo — sequence of mixed edits", () => {
  it("undo/redo through insert then delete", () => {
    const editor = new TestEditor(doc(p("hello")));

    editor.insertAt(6, "!"); // "hello!"
    editor.deleteRange(2, 3); // delete "e" → tracked_delete

    expect(editor.pendingChanges).toHaveLength(2);

    editor.undo(); // undo the delete
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.insert);

    editor.undo(); // undo the insert
    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges).toHaveLength(0);
  });

  it("redo restores edits in order after full undo", () => {
    const editor = new TestEditor(doc(p("hello")));

    editor.insertAt(6, "!");
    editor.undo();
    editor.redo();

    expect(editor.text).toBe("hello!");
    expect(editor.pendingChanges).toHaveLength(1);
  });
});

describe("undo/redo — node attribute change (paragraph → heading)", () => {
  it("undo after heading change reverts to paragraph", () => {
    const editor = new TestEditor(doc(p("hello")));

    // Change paragraph to heading by dispatching a setNodeMarkup transaction
    const { schema } = editor.state;
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.type).toBe("node-attr-change");

    editor.undo();

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  });
});
