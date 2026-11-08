/**
 * What an agent reads of pending changes: every record, placed in the text it
 * reads, merged by the act it belongs to.
 */
import "@scrivr/export-semantic/augment";
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit, Table } from "@scrivr/core";
import type { SemanticChange, SemanticUnit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { toSemanticUnits, unitRichHash } from "@scrivr/export-semantic";
import { reviewChanges, TrackChanges, TrackChangesStatus } from "@scrivr/plugins";

type DocNode = Record<string, unknown>;

const para = (nodeId: string, text: string, marks?: DocNode[]): DocNode => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

function editorWith(content: DocNode[], userID = "alice") {
  return new ServerEditor({
    extensions: [StarterKit, Table, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content },
  });
}

const units = (editor: ServerEditor) => toSemanticUnits(editor, { groupBlocks: false });

function unitOf(editor: ServerEditor, id: string): SemanticUnit {
  const found = units(editor).find((u) => u.id === id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
}

const shape = ({ type, text, at, length }: SemanticChange) => ({ type, text, at, length });

const tracked = (operation: string, authorID: string, extra: DocNode = {}) => ({
  dataTracked: { id: `${operation}-${authorID}`, operation, authorID, status: "pending", createdAt: 1, ...extra },
});

describe("a pending insertion", () => {
  it("reads as a suggestedInsert placed on the text it added", () => {
    const editor = editorWith([para("a", "Alpha one")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 1));
    const unit = unitOf(editor, "a");
    expect(unit.text).toBe("NEW Alpha one");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedInsert", text: "NEW ", at: 0, length: 4 }]);
    const [change] = unit.changes ?? [];
    expect(change?.authorId).toBe("alice");
    expect(unit.text.slice(change?.at, (change?.at ?? 0) + (change?.length ?? 0))).toBe("NEW ");
  });

  it("counts a hard break as one character", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [{ type: "text", text: "ab" }, { type: "hardBreak" }, { type: "text", text: "cd" }],
    }]);
    editor.applyTransaction(editor.getState().tr.insertText("X", 5));
    const unit = unitOf(editor, "a");
    expect(unit.text).toBe("ab\ncXd");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedInsert", text: "X", at: 4, length: 1 }]);
  });
});

describe("a pending deletion", () => {
  it("sits at the gap its text left, with no length", () => {
    const editor = editorWith([para("a", "Alpha one")]);
    editor.applyTransaction(editor.getState().tr.delete(6, 10));
    expect(unitOf(editor, "a").changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: " one", at: 5, length: 0 }]);
  });

  it("is one change across formatting runs", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [{ type: "text", text: "Al" }, { type: "text", text: "pha", marks: [{ type: "bold" }] }, { type: "text", text: " one" }],
    }]);
    editor.applyTransaction(editor.getState().tr.delete(2, 7));
    expect(unitOf(editor, "a").changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "lpha ", at: 1, length: 0 }]);
  });
});

describe("structural changes", () => {
  it("reads a deleted paragraph break as a deleted newline at the block's end", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    editor.applyTransaction(editor.getState().tr.delete(6, 8));
    const unit = unitOf(editor, "a");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "\n", at: 5, length: 0 }]);
    expect(unitOf(editor, "b").changes).toBeUndefined();
  });

  it("reads a split as one inserted newline where the first block ends", () => {
    const editor = editorWith([para("a", "AlphaBeta")]);
    editor.applyTransaction(editor.getState().tr.split(6));
    const all = units(editor);
    expect(all.map((u) => u.text)).toEqual(["Alpha", "Beta"]);
    expect(all[0]?.changes?.map(shape)).toEqual([{ type: "suggestedInsert", text: "\n", at: 5, length: 0 }]);
    expect(all[1]?.changes).toBeUndefined();
  });

  it("reads an inserted block as one insertion covering it", () => {
    const editor = editorWith([para("a", "Alpha")]);
    const { schema } = editor.getState();
    editor.applyTransaction(editor.getState().tr.insert(7, schema.nodes["paragraph"]?.create({ nodeId: "n" }, schema.text("New para")) ?? []));
    expect(unitOf(editor, "n").changes?.map(shape)).toEqual([{ type: "suggestedInsert", text: "New para", at: 0, length: 8 }]);
  });

  it("reads a deleted block as one deletion of its text", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta two"), para("c", "Gamma")]);
    editor.applyTransaction(editor.getState().tr.delete(7, 17));
    const unit = unitOf(editor, "b");
    expect(unit.text).toBe("");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "Beta two", at: 0, length: 0 }]);
  });

  it("reads a paragraph made a heading as an attribute change naming the old type", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Late payment")]);
    const heading = editor.getState().schema.nodes["heading"];
    if (!heading) throw new Error("no heading");
    editor.applyTransaction(editor.getState().tr.setNodeMarkup(7, heading, { level: 2, nodeId: "b" }));
    const unit = unitOf(editor, "b");
    expect(unit.type).toBe("heading");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedAttrs", text: "", at: 0, length: 12 }]);
    expect(unit.changes?.[0]?.oldAttrs).toEqual({ nodeType: "paragraph" });
  });

  it("reads a heading's level change with its old level", () => {
    const editor = editorWith([{ type: "heading", attrs: { nodeId: "h", level: 1 }, content: [{ type: "text", text: "Title" }] }]);
    const heading = editor.getState().schema.nodes["heading"];
    if (!heading) throw new Error("no heading");
    editor.applyTransaction(editor.getState().tr.setNodeMarkup(0, heading, { level: 2, nodeId: "h" }));
    expect(unitOf(editor, "h").changes?.[0]?.oldAttrs).toEqual({ level: 1 });
  });

  it("reads a list change on the list item it happened to", () => {
    const editor = editorWith([para("a", "one"), para("b", "two")]);
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, 8)));
    editor.commands.toggleBulletList();
    const list = units(editor).find((u) => u.type === "list");
    const part = list?.parts?.find((p) => p.nodeId === "b");
    const change = part?.changes?.find((c) => c.type === "suggestedAttrs");
    expect(change?.oldAttrs).toEqual({ list: [] });
    expect(change?.at).toBe(0);
    expect(change?.length).toBe(3);
    expect(list?.changes?.some((c) => c.id === change?.id)).toBe(true);
  });

  it("reads an inserted and a deleted table row on the table", () => {
    const cell = (id: string, text: string): DocNode => ({ type: "tableCell", content: [para(id, text)] });
    const editor = editorWith([{
      type: "table", attrs: { nodeId: "t" },
      content: [
        { type: "tableRow", attrs: { nodeId: "r1" }, content: [cell("a", "a1"), cell("b", "b1")] },
        { type: "tableRow", attrs: { nodeId: "r2" }, content: [cell("c", "c2"), cell("d", "d2")] },
      ],
    }]);
    const firstRow = editor.getState().doc.child(0).child(0);
    editor.applyTransaction(editor.getState().tr.delete(1, 1 + firstRow.nodeSize));
    const deleted = unitOf(editor, "t").changes?.filter((c) => c.type === "suggestedDelete") ?? [];
    expect(deleted.map((c) => c.text)).toEqual(["a1b1"]);

    const table = editor.getState().doc.child(0);
    const row = table.child(1).type.create({ nodeId: "r3" }, table.child(1).content);
    editor.applyTransaction(editor.getState().tr.insert(1 + table.content.size, row));
    const inserted = unitOf(editor, "t").changes?.filter((c) => c.type === "suggestedInsert") ?? [];
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.length).toBe(5);
  });

  it("reads a moved block on its destination, paired by moveId", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta"), para("c", "Gamma")]);
    const state = editor.getState();
    const moved = state.doc.child(0);
    editor.applyTransaction(state.tr.insert(state.doc.content.size, moved).delete(0, moved.nodeSize));
    const copies = units(editor).filter((u) => u.id === "a");
    const insert = copies.flatMap((u) => u.changes ?? []).find((c) => c.type === "suggestedInsert");
    const remove = copies.flatMap((u) => u.changes ?? []).find((c) => c.type === "suggestedDelete");
    expect(insert?.moveId).toBeDefined();
    expect(remove?.moveId).toBe(insert?.moveId);
  });

  it("reads a text move as two halves sharing a moveId", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [
        { type: "text", text: "moved ", marks: [{ type: "trackedInsert", attrs: tracked("insert", "alice", { moveId: "m1" }) }] },
        { type: "text", text: "stay " },
        { type: "text", text: "moved ", marks: [{ type: "trackedDelete", attrs: tracked("delete", "alice", { moveId: "m1" }) }] },
      ],
    }]);
    expect(unitOf(editor, "a").changes?.map((c) => [c.type, c.moveId])).toEqual([
      ["suggestedInsert", "m1"],
      ["suggestedDelete", "m1"],
    ]);
  });
});

describe("text two authors changed", () => {
  it("keeps the insertion, with no length, beside the deletion of it", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [
        { type: "text", text: "Keep " },
        { type: "text", text: "NEW", marks: [
          { type: "trackedInsert", attrs: tracked("insert", "alice") },
          { type: "trackedDelete", attrs: tracked("delete", "bob") },
        ] },
      ],
    }]);
    const unit = unitOf(editor, "a");
    expect(unit.text).toBe("Keep ");
    expect(unit.changes?.map((c) => ({ ...shape(c), authorId: c.authorId }))).toEqual([
      { type: "suggestedInsert", text: "NEW", at: 5, length: 0, authorId: "alice" },
      { type: "suggestedDelete", text: "NEW", at: 5, length: 0, authorId: "bob" },
    ]);
  });
});

describe("the rich hash", () => {
  it("is unchanged for a unit with no review changes", () => {
    const editor = editorWith([para("a", "Alpha one")]);
    expect(unitRichHash(unitOf(editor, "a"))).toBe("b67f4ba1");
  });

  it("moves when a pending insertion is accepted, though the text stays the same", () => {
    const editor = editorWith([para("a", "Alpha")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 1));
    const before = unitOf(editor, "a");
    const id = before.changes?.[0]?.id ?? "";
    expect(reviewChanges(editor, { accepted: [id], rejected: [] }).status).toBe("applied");
    const after = unitOf(editor, "a");
    expect(after.text).toBe(before.text);
    expect(unitRichHash(after)).not.toBe(unitRichHash(before));
  });

  it("moves when a pending insertion is rejected", () => {
    const editor = editorWith([para("a", "Alpha")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 1));
    const before = unitOf(editor, "a");
    const id = before.changes?.[0]?.id ?? "";
    expect(reviewChanges(editor, { accepted: [], rejected: [id] }).status).toBe("applied");
    expect(unitRichHash(unitOf(editor, "a"))).not.toBe(unitRichHash(before));
  });
});
