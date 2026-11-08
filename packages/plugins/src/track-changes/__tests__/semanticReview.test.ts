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
import { changeActs, reviewChanges, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";

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
  dataTracked: { id: `${operation}-${authorID}`, operation, authorID, status: "pending", createdAt: 1, updatedAt: 1, ...extra },
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
    expect(deleted.map((c) => c.text)).toEqual(["a1\nb1"]);

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
  it("keeps the insertion, with nothing left of it, beside the deletion of it", () => {
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
      { type: "suggestedInsert", text: "", at: 5, length: 0, authorId: "alice" },
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

describe("one act reads under one id", () => {
  const cell = (id: string, text: string): DocNode => ({ type: "tableCell", content: [para(id, text)] });

  it("everywhere a whole deleted table is read: unit, parts and cells", () => {
    const editor = editorWith([para("p0", "before"), {
      type: "table", attrs: { nodeId: "t" },
      content: [
        { type: "tableRow", attrs: { nodeId: "r1" }, content: [cell("a", "a1"), cell("b", "b1")] },
        { type: "tableRow", attrs: { nodeId: "r2" }, content: [cell("c", "c2"), cell("d", "d2")] },
      ],
    }, para("p9", "after")]);
    const { doc } = editor.getState();
    const start = doc.child(0).nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(start, start + doc.child(1).nodeSize));
    const table = unitOf(editor, "t");
    const ids = new Set([
      ...(table.changes ?? []).map((c) => c.id),
      ...(table.parts ?? []).flatMap((p) => p.changes ?? []).map((c) => c.id),
      ...(table.cells?.rows ?? []).flatMap((r) => r.cells).flatMap((c) => c.changes ?? []).map((c) => c.id),
    ]);
    expect(ids.size).toBe(1);
    expect(table.changes).toHaveLength(1);
  });

});

describe("an act's text keeps the breaks between its blocks", () => {
  const item = (id: string, text: string): DocNode => ({ type: "listItem", content: [para(id, text)] });

  it("for a deleted list", () => {
    const editor = editorWith([para("p0", "before"), { type: "bulletList", attrs: { nodeId: "l" }, content: [item("i1", "one"), item("i2", "two")] }]);
    const { doc } = editor.getState();
    const start = doc.child(0).nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(start, start + doc.child(1).nodeSize));
    const list = units(editor).find((u) => u.type === "list");
    expect(list?.changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "one\ntwo", at: 0, length: 0 }]);
    const actId = list?.changes?.[0]?.id;
    expect((list?.parts ?? []).map((p) => p.changes?.map((c) => c.id))).toEqual([[actId], [actId]]);
  });

  it("for an inserted list, which reads exactly the text it spans", () => {
    const editor = editorWith([para("a", "Alpha")]);
    const { schema } = editor.getState();
    const [list, listItem, paragraph] = [schema.nodes["bulletList"], schema.nodes["listItem"], schema.nodes["paragraph"]];
    if (!list || !listItem || !paragraph) throw new Error("no list");
    const entry = (id: string, text: string) => listItem.create(null, paragraph.create({ nodeId: id }, schema.text(text)));
    editor.applyTransaction(editor.getState().tr.insert(7, list.create({ nodeId: "l" }, [entry("i1", "hello"), entry("i2", "world")])));
    const unit = units(editor).find((u) => u.type === "list");
    const [change] = unit?.changes ?? [];
    expect(change && shape(change)).toEqual({ type: "suggestedInsert", text: "hello\nworld", at: 0, length: 11 });
    expect(unit?.text.slice(change?.at, (change?.at ?? 0) + (change?.length ?? 0))).toBe(change?.text);
  });
});

describe("pieces of one act carry what each says", () => {
  it("a deletion keeps no length when another author's text sits inside it", () => {
    const editor = editorWith([para("a", "Alpha one two")]);
    editor.applyTransaction(editor.getState().tr.delete(3, 10));
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("X", 6));
    const alice = (unitOf(editor, "a").changes ?? []).filter((c) => c.authorId === "alice");
    expect(alice.map(shape)).toEqual([{ type: "suggestedDelete", text: "pha one", at: 2, length: 0 }]);
  });

  it("a deleted paragraph with an image says which image goes with it", () => {
    const editor = editorWith([para("a", "Alpha"), {
      type: "paragraph", attrs: { nodeId: "fig" },
      content: [{ type: "text", text: "cap " }, { type: "image", attrs: { src: "https://example.com/a.png", alt: "A" } }],
    }]);
    const { doc } = editor.getState();
    editor.applyTransaction(editor.getState().tr.delete(doc.child(0).nodeSize, doc.content.size));
    const changes = unitOf(editor, "fig").changes ?? [];
    expect(changes.map((c) => [c.type, c.text, c.image?.src])).toEqual([
      ["suggestedDelete", "cap ", undefined],
      ["suggestedDelete", "", "https://example.com/a.png"],
    ]);
    expect(new Set(changes.map((c) => c.id)).size).toBe(1);
  });

  it("an inserted paragraph holding two images shows both, under one id", () => {
    const editor = editorWith([para("a", "Alpha")]);
    const { schema } = editor.getState();
    const [paragraph, image] = [schema.nodes["paragraph"], schema.nodes["image"]];
    if (!paragraph || !image) throw new Error("no image");
    const img = (name: string) => image.create({ src: `https://example.com/${name}.png`, alt: name });
    editor.applyTransaction(editor.getState().tr.insert(7, paragraph.create({ nodeId: "pics" }, [img("a"), img("b")])));
    const changes = unitOf(editor, "pics").changes ?? [];
    expect(changes.flatMap((c) => c.image?.src ?? [])).toEqual(["https://example.com/a.png", "https://example.com/b.png"]);
    expect(new Set(changes.map((c) => c.id)).size).toBe(1);
  });

  it("an insertion another author deleted part of reads what remains", () => {
    const editor = editorWith([para("a", "Alpha")]);
    editor.applyTransaction(editor.getState().tr.insertText("XYZ", 3));
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.delete(4, 5));
    const unit = unitOf(editor, "a");
    const alice = (unit.changes ?? []).filter((c) => c.authorId === "alice");
    expect(alice.map(shape)).toEqual([{ type: "suggestedInsert", text: "XZ", at: 2, length: 2 }]);
    expect(unit.text.slice(2, 4)).toBe("XZ");
  });

  it("a formatting act over runs with different marks states each run's marks", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [{ type: "text", text: "ab" }, { type: "text", text: "cd", marks: [{ type: "italic" }] }],
    }]);
    const bold = editor.getState().schema.marks["bold"];
    if (!bold) throw new Error("no bold");
    editor.applyTransaction(editor.getState().tr.addMark(1, 5, bold.create()));
    const changes = unitOf(editor, "a").changes ?? [];
    expect(changes.map((c) => [c.at, c.length, c.oldAttrs])).toEqual([
      [0, 2, { marks: [] }],
      [2, 2, { marks: [{ type: "italic" }] }],
    ]);
    expect(new Set(changes.map((c) => c.id)).size).toBe(1);
  });

  it("a removed mark is gone from the proposed spans", () => {
    const editor = editorWith([para("a", "Alpha", [{ type: "bold" }])]);
    const bold = editor.getState().schema.marks["bold"];
    if (!bold) throw new Error("no bold");
    editor.applyTransaction(editor.getState().tr.removeMark(1, 6, bold));
    const unit = unitOf(editor, "a");
    expect(unit.spans).toBeUndefined();
    expect(unit.changes?.[0]?.oldAttrs).toEqual({ marks: [{ type: "bold" }] });
  });
});

describe("records that are not pending, or not well formed", () => {
  it("a decided record is not reported", () => {
    const editor = editorWith([para("a", "Alpha", [{ type: "trackedInsert", attrs: tracked("insert", "alice", { status: "accepted" }) }])]);
    expect(unitOf(editor, "a").changes).toBeUndefined();
  });

  it("a malformed record reports only what it says correctly, and does not throw", () => {
    const editor = editorWith([{
      type: "paragraph",
      attrs: {
        nodeId: "a",
        dataTracked: [
          { id: 5, authorID: {}, createdAt: "soon", groupId: 7, operation: "list_change", status: "pending", oldList: [null, { type: 3 }, { type: "bulletList" }] },
          { id: "s", operation: "set_attrs", status: "pending", oldAttrs: "bad", oldNodeTypeName: 7 },
        ],
      },
      content: [{ type: "text", text: "Alpha" }],
    }]);
    const changes = unitOf(editor, "a").changes ?? [];
    expect(changes[0]).toEqual({ type: "suggestedAttrs", text: "", at: 0, length: 5, status: "pending", oldAttrs: { list: ["bulletList"] } });
    expect(changes[1]).toMatchObject({ type: "suggestedAttrs", id: "s", oldAttrs: {} });
  });
});

describe("a deleted hard break", () => {
  it("leaves the proposed text and reads as a deleted newline", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "p" },
      content: [{ type: "text", text: "ab" }, { type: "hardBreak" }, { type: "text", text: "cd" }],
    }]);
    editor.applyTransaction(editor.getState().tr.delete(3, 4));
    const unit = unitOf(editor, "p");
    expect(unit.text).toBe("abcd");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "\n", at: 2, length: 0 }]);
  });

  it("reads as many changes as the acts a reviewer decides, with the break among them", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "p" },
      content: [{ type: "text", text: "ab" }, { type: "hardBreak" }, { type: "text", text: "cd" }],
    }]);
    editor.applyTransaction(editor.getState().tr.delete(2, 5));
    const unit = unitOf(editor, "p");
    expect(unit.text).toBe("ad");
    const acts = changeActs(trackChangesPluginKey.getState(editor.getState())?.changeSet.pending ?? []);
    expect(unit.changes?.map((c) => c.id).sort()).toEqual(acts.map((a) => a.primary.id).sort());
    expect(unit.changes?.map(shape)).toContainEqual({ type: "suggestedDelete", text: "\n", at: 1, length: 0 });
  });

  it("is part of a deleted block's text, which keeps all of it", () => {
    const editor = editorWith([para("a", "Alpha"), {
      type: "paragraph", attrs: { nodeId: "p" },
      content: [{ type: "text", text: "ab" }, { type: "hardBreak" }, { type: "text", text: "cd" }],
    }]);
    const { doc } = editor.getState();
    editor.applyTransaction(editor.getState().tr.delete(doc.child(0).nodeSize, doc.content.size));
    const unit = unitOf(editor, "p");
    expect(unit.text).toBe("");
    expect(unit.changes?.map(shape)).toEqual([{ type: "suggestedDelete", text: "ab\ncd", at: 0, length: 0 }]);
  });
});

describe("authors working inside each other's changes", () => {
  it("reads an insertion another author typed inside once", () => {
    const editor = editorWith([para("a", "Alpha")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW", 1));
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("x", 3));
    const changes = unitOf(editor, "a").changes ?? [];
    expect(changes.filter((c) => c.authorId === "alice").map(shape)).toEqual([{ type: "suggestedInsert", text: "NEW", at: 0, length: 4 }]);
    expect(changes.filter((c) => c.authorId === "bob").map(shape)).toEqual([{ type: "suggestedInsert", text: "x", at: 2, length: 1 }]);
  });

  it("reads a deletion spanning another author's insertion as one deletion of all of it", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW", 9));
    editor.commands.setTrackChangesUserID("bob");
    const { doc } = editor.getState();
    editor.applyTransaction(editor.getState().tr.delete(doc.child(0).nodeSize, doc.content.size));
    const bob = (unitOf(editor, "b").changes ?? []).filter((c) => c.authorId === "bob");
    expect(bob.map(shape)).toEqual([{ type: "suggestedDelete", text: "BNEWeta", at: 0, length: 0 }]);
  });
});

describe("a formatting change", () => {
  it("reads as an attribute change over the formatted text, with the marks it had", () => {
    const editor = editorWith([para("a", "Alpha one")]);
    const bold = editor.getState().schema.marks["bold"];
    if (!bold) throw new Error("no bold");
    editor.applyTransaction(editor.getState().tr.addMark(1, 6, bold.create()));
    const changes = unitOf(editor, "a").changes ?? [];
    expect(changes.map(shape)).toEqual([{ type: "suggestedAttrs", text: "", at: 0, length: 5 }]);
    expect(changes[0]?.oldAttrs).toEqual({ marks: [] });
  });
});

describe("a wrapped or structurally moved node", () => {
  it("reads as an insertion", () => {
    const editor = editorWith([{
      type: "bulletList",
      attrs: tracked("wrap_with_node", "alice"),
      content: [{ type: "listItem", content: [para("i", "one")] }],
    }, {
      type: "paragraph",
      attrs: { nodeId: "s", ...tracked("structure", "alice", { moveNodeId: "m" }) },
      content: [{ type: "text", text: "moved" }],
    }]);
    expect(units(editor).find((u) => u.type === "list")?.changes?.map(shape)).toEqual([{ type: "suggestedInsert", text: "one", at: 0, length: 3 }]);
    expect(unitOf(editor, "s").changes?.map((c) => [c.type, c.moveId])).toEqual([["suggestedInsert", "m"]]);
  });
});

describe("a deleted image", () => {
  it("says which image is removed", () => {
    const editor = editorWith([{ type: "paragraph", attrs: { nodeId: "fig" }, content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "A" } }] }]);
    editor.applyTransaction(editor.getState().tr.delete(1, 2));
    const [change] = unitOf(editor, "fig").changes ?? [];
    expect(change?.type).toBe("suggestedDelete");
    expect(change?.image).toMatchObject({ src: "https://example.com/a.png", alt: "A" });
  });
});

describe("a block proposed for deletion is marked so on its unit", () => {
  it("when the block itself is deleted, even holding another author's insertion", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW", 9));
    editor.commands.setTrackChangesUserID("bob");
    const { doc } = editor.getState();
    editor.applyTransaction(editor.getState().tr.delete(doc.child(0).nodeSize, doc.content.size));
    expect(unitOf(editor, "b").proposedForDeletion).toBe(true);
    expect(unitOf(editor, "a").proposedForDeletion).toBeUndefined();
  });

  it("not when only its text is struck, or only its break", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta"), { type: "paragraph", attrs: { nodeId: "e" } }, para("c", "Gamma")]);
    editor.applyTransaction(editor.getState().tr.delete(1, 6));
    const emptyAt = editor.getState().doc.child(0).nodeSize + editor.getState().doc.child(1).nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(emptyAt + 1, emptyAt + 3));
    const read = units(editor);
    expect(read.find((u) => u.id === "a")?.text).toBe("");
    expect(read.find((u) => u.id === "e")?.changes?.map((c) => c.text)).toEqual(["\n"]);
    expect(read.filter((u) => u.proposedForDeletion)).toEqual([]);
  });
});

describe("records built straight into a synced document", () => {
  it("name an act by a pending record, never by a decided one grouped with it", () => {
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [
        { type: "text", text: "old", marks: [{ type: "trackedDelete", attrs: tracked("delete", "alice", { id: "decided", groupId: "g", status: "accepted" }) }] },
        { type: "text", text: "new", marks: [{ type: "trackedInsert", attrs: tracked("insert", "alice", { id: "open", groupId: "g" }) }] },
      ],
    }]);
    expect(unitOf(editor, "a").changes?.map((c) => [c.type, c.id])).toEqual([["suggestedInsert", "open"]]);
  });

  it("keep text whose deletion is already decided in the proposed text, reporting nothing for it", () => {
    const editor = editorWith([para("a", "Alpha", [{ type: "trackedDelete", attrs: tracked("delete", "alice", { status: "rejected" }) }])]);
    const unit = unitOf(editor, "a");
    expect(unit.text).toBe("Alpha");
    expect(unit.changes).toBeUndefined();
  });

  it("ignore an operation they do not know, on a node or on a mark", () => {
    const editor = editorWith([{
      type: "paragraph",
      attrs: { nodeId: "a", dataTracked: [{ id: "x", operation: "toString", status: "pending" }] },
      content: [{ type: "text", text: "Alpha", marks: [{ type: "bold", attrs: { dataTracked: [{ id: "y", operation: "bogus", status: "pending" }] } }] }],
    }]);
    expect(unitOf(editor, "a").changes).toBeUndefined();
  });

  it("read a formatting change as separate changes for runs that do not touch", () => {
    const bold = { type: "bold", attrs: { dataTracked: [{ id: "f", operation: "insert", authorID: "alice", status: "pending", createdAt: 1 }] } };
    const editor = editorWith([{
      type: "paragraph", attrs: { nodeId: "a" },
      content: [{ type: "text", text: "ab", marks: [bold] }, { type: "text", text: "cd" }, { type: "text", text: "ef", marks: [bold] }],
    }]);
    expect(unitOf(editor, "a").changes?.map((c) => [c.at, c.length])).toEqual([[0, 2], [4, 2]]);
  });

  it("agree on a mark both added and proposed for removal: absent before and after", () => {
    const records = [
      { id: "add", operation: "insert", authorID: "alice", status: "pending", createdAt: 1 },
      { id: "drop", operation: "delete", authorID: "bob", status: "pending", createdAt: 2 },
    ];
    const editor = editorWith([para("a", "Alpha", [{ type: "bold", attrs: { dataTracked: records } }])]);
    const unit = unitOf(editor, "a");
    expect(unit.spans).toBeUndefined();
    expect((unit.changes ?? []).map((c) => c.oldAttrs)).toEqual([{ marks: [] }, { marks: [] }]);
  });

  it("survive a former node type that cannot be created there", () => {
    for (const oldNodeTypeName of ["text", "image", "nope"]) {
      const editor = editorWith([{
        type: "paragraph",
        attrs: { nodeId: "a", dataTracked: [{ id: "s", operation: "set_attrs", status: "pending", oldAttrs: {}, oldNodeTypeName }] },
        content: [{ type: "text", text: "Alpha" }],
      }]);
      expect(unitOf(editor, "a").changes?.[0]?.oldAttrs).toEqual({});
    }
  });
});
