import { describe, it, expect } from "vitest";
import { doc, p, h, TestEditor, schema } from "./helpers";
import { CHANGE_OPERATION } from "../types";
import type { NodeAttrChange, TextChange } from "../types";

// ── Text change detection ──────────────────────────────────────────────────────

describe("findChanges — text insert detection", () => {
  it("insert produces a text-change with operation=insert", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("text-change");
    expect(change.dataTracked.operation).toBe(CHANGE_OPERATION.insert);
  });

  it("inserted text range covers exactly the inserted chars", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!"); // "!" at pos 6, node size 1 → [6, 7)

    const change = editor.pendingChanges[0]!;
    expect(change.from).toBe(6);
    expect(change.to).toBe(7);
  });

  it("adjacent inserts from the same author merge into one text-change", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!"); // append "!"
    editor.insertAt(7, "?"); // append "?" right after "!"

    // Adjacent same-author inserts share one tracking mark → one change
    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.insert);
  });

  it("non-adjacent inserts from the same author are separate text-changes", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!"); // after "hello"
    editor.insertAt(2, "X"); // inside "hello"

    expect(editor.pendingChanges).toHaveLength(2);
    expect(
      editor.pendingChanges.every(c => c.dataTracked.operation === CHANGE_OPERATION.insert),
    ).toBe(true);
  });
});

describe("findChanges — text delete detection", () => {
  it("delete produces a text-change with operation=delete", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(5, 6); // delete "o"

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("text-change");
    expect(change.dataTracked.operation).toBe(CHANGE_OPERATION.delete);
  });

  it("deleted text stays in the document (trackedDelete keeps it visible)", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(5, 6); // delete "o"

    expect(editor.text).toBe("hello");
    expect(editor.pendingChanges[0]!.dataTracked.operation).toBe(CHANGE_OPERATION.delete);
  });

  it("delete range covers the deleted chars", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.deleteRange(2, 4); // delete "el"

    const change = editor.pendingChanges[0]!;
    expect(change.from).toBe(2);
    expect(change.to).toBe(4);
  });
});

// ── Node attr change detection ─────────────────────────────────────────────────

describe("findChanges — node-attr-change detection", () => {
  it("paragraph→heading produces a node-attr-change", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }));

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("node-attr-change");
    expect(change.dataTracked.operation).toBe(CHANGE_OPERATION.set_node_attributes);
  });

  it("node-attr-change has oldAttrs reflecting the pre-change type", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }));

    const change = editor.pendingChanges[0]! as NodeAttrChange;
    // paragraph has no level attr → null
    expect(change.oldAttrs?.level ?? null).toBeNull();
  });

  it("node-attr-change has newAttrs reflecting the new heading level", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }));

    const change = editor.pendingChanges[0]! as NodeAttrChange;
    expect(change.newAttrs?.level).toBe(2);
  });

  it("h1→h2 node-attr-change has oldAttrs.level=1 and newAttrs.level=2", () => {
    const editor = new TestEditor(doc(h(1, "hello")));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 }));

    const change = editor.pendingChanges[0]! as NodeAttrChange;
    expect(change.oldAttrs?.level).toBe(1);
    expect(change.newAttrs?.level).toBe(2);
  });

  it("heading→paragraph produces a node-attr-change (type change tracked)", () => {
    const editor = new TestEditor(doc(h(2, "hello")));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.paragraph, {}));

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.type).toBe("node-attr-change");
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  });
});

// ── Conflict detection ─────────────────────────────────────────────────────────

describe("findChanges — conflict detection", () => {
  it("opposing insert+delete from different authors on the same text are flagged isConflict", () => {
    // Start with an empty paragraph; author1 inserts "hello".
    const editor = new TestEditor(doc(p("")), "author1");
    editor.insertAt(1, "hello"); // trackedInsert on "hello" from author1

    // Switch to author2 and delete the same range that author1 just inserted.
    // deleteTextIfInserted sees a different-author insert → adds trackedDelete on top
    // rather than removing the text. The same text node now has both marks.
    editor.setUserID("author2");
    editor.deleteRange(1, 6); // covers "hello" (still in doc with trackedInsert)

    const pending = editor.pendingChanges;
    // Both insert (author1) and delete (author2) should be pending
    expect(pending.length).toBeGreaterThanOrEqual(2);

    const deleteChange = pending.find(c => c.dataTracked.operation === CHANGE_OPERATION.delete)!;
    const insertChange = pending.find(c => c.dataTracked.operation === CHANGE_OPERATION.insert)!;

    expect(deleteChange).toBeDefined();
    expect(insertChange).toBeDefined();
    expect(deleteChange.dataTracked.isConflict).toBe(true);
    expect(insertChange.dataTracked.isConflict).toBe(true);
  });

  it("same-author insert+delete do NOT produce a conflict", () => {
    const editor = new TestEditor(doc(p("hello")), "author1");

    editor.deleteRange(1, 4); // delete "hel" — trackedDelete
    editor.insertAt(1, "X"); // insert at same position

    const pending = editor.pendingChanges;
    // Both changes from the same author → no conflict regardless of ops
    expect(pending.every(c => !c.dataTracked.isConflict)).toBe(true);
  });

  it("two inserts from different authors at the same position do NOT conflict (non-opposing)", () => {
    const editor = new TestEditor(doc(p("hello")), "author1");
    editor.insertAt(6, "!"); // author1 inserts "!"

    editor.setUserID("author2");
    editor.insertAt(6, "?"); // author2 inserts "?" at same pos

    const pending = editor.pendingChanges;
    // Both are inserts (not opposing) → no conflict
    expect(pending.every(c => !c.dataTracked.isConflict)).toBe(true);
  });

  it("non-overlapping insert+delete from different authors do NOT conflict", () => {
    const editor = new TestEditor(doc(p("hello world")), "author1");
    editor.deleteRange(1, 4); // delete "hel" at start

    editor.setUserID("author2");
    editor.insertAt(10, "!"); // insert near end, well outside delete range

    const pending = editor.pendingChanges;
    expect(pending.every(c => !c.dataTracked.isConflict)).toBe(true);
  });
});

// ── ChangeSet deduplication ────────────────────────────────────────────────────

describe("findChanges — ChangeSet deduplication", () => {
  it("all change IDs are unique in the changeSet", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");
    editor.insertAt(2, "X");
    editor.deleteRange(8, 9);

    const ids = editor.allChanges.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Fix 1: invalid ID guard ────────────────────────────────────────────────────

describe("findChanges — invalid ID guard", () => {
  it("no change has an empty-string id", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");
    editor.insertAt(2, "X");

    const ids = editor.allChanges.map(c => c.id);
    expect(ids.every(id => id && id.length > 0)).toBe(true);
  });
});

// ── Fix 2: text accumulation ──────────────────────────────────────────────────

describe("findChanges — text accumulation across adjacent text nodes", () => {
  it("single insert change has correct text content", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");

    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("text-change");
    expect((change as TextChange).text).toBe("!");
  });

  it("multiple adjacent inserts from same author merge into one change with full text", () => {
    const editor = new TestEditor(doc(p("hello")));
    // Type "AB" one char at a time — adjacent same-author inserts merge
    editor.insertAt(6, "A");
    editor.insertAt(7, "B");

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]! as TextChange;
    expect(change.text).toBe("AB");
  });
});

// ── Fix 3: mark change grouping ───────────────────────────────────────────────

describe("findChanges — mark changes are grouped by ID", () => {
  it("one insert produces exactly one change, not one per character", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "world"); // 5 chars inserted under same tracking ID

    // Should be one logical change, not 5 separate mark-change entries
    expect(editor.pendingChanges).toHaveLength(1);
  });

  it("change covers the full inserted range", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "world");

    const change = editor.pendingChanges[0]!;
    // "world" is 5 chars inserted after "hello" (pos 6..11)
    expect(change.to - change.from).toBe(5);
  });

  it("two non-adjacent inserts from same author remain separate changes", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");
    editor.insertAt(2, "X");

    expect(editor.pendingChanges).toHaveLength(2);
  });

  it("changes from different authors in same paragraph are separate", () => {
    const editor = new TestEditor(doc(p("hello")), "author1");
    editor.insertAt(6, "!");

    editor.setUserID("author2");
    editor.insertAt(2, "X");

    expect(editor.pendingChanges).toHaveLength(2);
    const authors = editor.pendingChanges.map(c => c.dataTracked.authorID);
    expect(authors).toContain("author1");
    expect(authors).toContain("author2");
  });
});
