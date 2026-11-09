/**
 * An agent reads pending changes through `getRichBlocks` and decides them
 * through `reviewChanges`, by the ids it read.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { SemanticUnit } from "@scrivr/core";
import { redo, undo } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit, getAiToolkit, unitRichHash } from "../../index";

type DocNode = Record<string, unknown>;

const para = (nodeId: string, text: string): DocNode => ({
  type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }],
});

function build(content: DocNode[], canAcceptReject = true) {
  const editor = new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "jane", initialStatus: TrackChangesStatus.enabled, canAcceptReject }),
      AiToolkit,
    ],
    content: { type: "doc", content },
  });
  const ai = getAiToolkit(editor);
  if (!ai) throw new Error("no AiToolkit");
  return { editor, ai };
}

function unitOf(units: SemanticUnit[], id: string): SemanticUnit {
  const unit = units.find((u) => u.id === id);
  if (!unit) throw new Error(`no unit ${id}`);
  return unit;
}

const pendingCount = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.length ?? 0;

function replaceThirty() {
  const built = build([para("p", "The fee is due in 30 days.")]);
  built.ai.applyRichEdit([{ nodeId: "p", spans: [{ text: "The fee is due in 45 days.", marks: [] }] }]);
  return built;
}

describe("an agent reads a replacement", () => {
  it("as a deletion and an insertion, placed, attributed and paired", () => {
    const { ai } = replaceThirty();
    const unit = unitOf(ai.getRichBlocks(), "p");
    expect(unit.text).toBe("The fee is due in 45 days.");
    const removed = unit.changes?.find((c) => c.type === "suggestedDelete");
    const added = unit.changes?.find((c) => c.type === "suggestedInsert");
    expect(removed).toMatchObject({ text: "30", at: 18, length: 0, authorId: "AI Assistant" });
    expect(added).toMatchObject({ text: "45", at: 18, length: 2, authorId: "AI Assistant" });
    expect(removed?.id).toBeDefined();
    expect(added?.id).toBeDefined();
    expect(added?.groupId).toBeDefined();
    expect(added?.groupId).toBe(removed?.groupId);
  });
});

describe("an agent sees structural changes", () => {
  it("keeps a block proposed for deletion, with nothing left to read but its deletion", () => {
    const { editor, ai } = build([para("a", "Alpha"), para("b", "Beta"), para("c", "Gamma")]);
    editor.applyTransaction(editor.getState().tr.delete(7, 13));
    const unit = unitOf(ai.getRichBlocks(), "b");
    expect(unit.text).toBe("");
    expect(unit.changes?.map((c) => [c.type, c.text])).toEqual([["suggestedDelete", "Beta"]]);
    const result = ai.applyRichEdit([{ nodeId: "b", spans: [{ text: "Revived", marks: [] }] }]);
    expect(result.changed).toEqual([]);
    expect(result.rejected).toEqual(["b"]);
  });

  it("keeps a deleted block that shares its id with a live one, as a split leaves", () => {
    const { editor, ai } = build([para("p", "AlphaBeta")]);
    editor.applyTransaction(editor.getState().tr.split(6));
    expect(ai.reviewChanges({ accepted: ai.getRichBlocks().flatMap((u) => u.changes ?? []).flatMap((c) => c.id ?? []), rejected: [] }).status).toBe("applied");
    const first = editor.getState().doc.child(0);
    editor.applyTransaction(editor.getState().tr.delete(0, first.nodeSize));
    expect(ai.getRichBlocks().map((u) => [u.text, u.changes?.map((c) => [c.type, c.text])])).toEqual([
      ["", [["suggestedDelete", "Alpha"]]],
      ["Beta", undefined],
    ]);
  });

  it("hands back two blocks sharing an id unchanged, as no edit at all", () => {
    const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta")]);
    editor.applyTransaction(editor.getState().tr.delete(0, editor.getState().doc.child(0).nodeSize));
    const before = editor.getState().doc;
    expect(ai.applyRichEdit(ai.getRichBlocks())).toEqual({ applied: false, changed: [], stale: [], notFound: [], rejected: [] });
    expect(editor.getState().doc.eq(before)).toBe(true);
  });

  it("hands back two list items sharing an id unchanged, as no edit at all", () => {
    const item = (text: string): DocNode => ({ type: "listItem", content: [para("i", text)] });
    const { editor, ai } = build([{ type: "bulletList", attrs: { nodeId: "l" }, content: [item("one"), item("two")] }]);
    const firstItem = editor.getState().doc.child(0).child(0);
    editor.applyTransaction(editor.getState().tr.delete(1, 1 + firstItem.nodeSize));
    const before = editor.getState().doc;
    expect(ai.applyRichEdit(ai.getRichBlocks())).toEqual({ applied: false, changed: [], stale: [], notFound: [], rejected: [] });
    expect(editor.getState().doc.eq(before)).toBe(true);
  });

  it("refuses an edit to the copy proposed for deletion, and edits the live copy", () => {
    const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta")]);
    editor.applyTransaction(editor.getState().tr.delete(0, editor.getState().doc.child(0).nodeSize));
    const [deleted, live] = ai.getRichBlocks();
    if (!deleted || !live) throw new Error("two units");
    const result = ai.applyRichEdit([{ ...deleted, text: "Revived", spans: [{ text: "Revived", marks: [] }] }, { ...live, text: "Gamma", spans: [{ text: "Gamma", marks: [] }] }]);
    expect(result).toMatchObject({ changed: ["p"], rejected: ["p"] });
    expect(ai.getRichBlocks().map((u) => u.text)).toEqual(["", "Gamma"]);
  });

  it("reads a moved block once, where it went", () => {
    const { editor, ai } = build([para("a", "Alpha"), para("b", "Beta"), para("c", "Gamma")]);
    const state = editor.getState();
    const moved = state.doc.child(0);
    editor.applyTransaction(state.tr.insert(state.doc.content.size, moved).delete(0, moved.nodeSize));
    const units = ai.getRichBlocks();
    expect(units.map((u) => u.id)).toEqual(["b", "c", "a"]);
    expect(unitOf(units, "a").changes?.[0]).toMatchObject({ type: "suggestedInsert", text: "Alpha" });
  });

  it("does not read a returned unit as an edit because it left out the changes", () => {
    const { ai } = replaceThirty();
    const units = ai.getRichBlocks().map(({ changes: _changes, ...unit }) => unit);
    expect(ai.applyRichEdit(units).changed).toEqual([]);
  });

  it("nor a returned list whose parts left out their changes (regression guard)", () => {
    const { editor, ai } = build([{
      type: "bulletList",
      content: [{ type: "listItem", content: [para("i1", "one")] }, { type: "listItem", content: [para("i2", "two")] }],
    }]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 3));
    const units = ai.getRichBlocks().map(({ changes: _changes, ...unit }) => ({
      ...unit,
      ...(unit.parts ? { parts: unit.parts.map(({ changes: _partChanges, ...part }) => part) } : {}),
    }));
    expect(units[0]?.parts?.length).toBe(2);
    const result = ai.applyRichEdit(units);
    expect(result).toEqual({ applied: false, changed: [], stale: [], notFound: [], rejected: [] });
  });

  it("nor a returned table whose cells left out their changes", () => {
    // Cells without ids have no parts, so the table is compared as a whole.
    const inserted = { type: "trackedInsert", attrs: { dataTracked: { id: "ins", operation: "insert", authorID: "jane", status: "pending", createdAt: 1 } } };
    const cell = (text: string, marks: DocNode[] = []): DocNode =>
      ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }] });
    const editor = new ServerEditor({
      extensions: [
        StarterKit.configure({ table: true }),
        TrackChanges.configure({ userID: "jane", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
        AiToolkit.configure({ uniqueId: false }),
      ],
      content: { type: "doc", content: [{ type: "table", attrs: { nodeId: "t" }, content: [{ type: "tableRow", content: [cell("NEW a1", [inserted]), cell("b1")] }] }] },
    });
    const ai = getAiToolkit(editor);
    if (!ai) throw new Error("no AiToolkit");
    expect(ai.getRichBlocks()[0]?.parts).toBeUndefined();
    const units = ai.getRichBlocks().map(({ changes: _changes, ...unit }) => ({
      ...unit,
      ...(unit.parts ? { parts: unit.parts.map(({ changes: _partChanges, ...part }) => part) } : {}),
      ...(unit.cells ? { cells: { rows: unit.cells.rows.map((row) => ({ cells: row.cells.map(({ changes: _cellChanges, ...c }) => c) })) } } : {}),
    }));
    expect(units[0]?.cells?.rows[0]?.cells[0]?.text).toBe("NEW a1");
    expect(ai.applyRichEdit(units)).toEqual({ applied: false, changed: [], stale: [], notFound: [], rejected: [] });
  });
});

describe("an agent's edit lands on the block it read", () => {
  const rewrite = (unit: SemanticUnit, text: string): SemanticUnit => ({ ...unit, text, spans: [{ text, marks: [] }] });
  const acceptAll = (editor: ServerEditor, ai: ReturnType<typeof build>["ai"]) =>
    ai.reviewChanges({ accepted: (trackChangesPluginKey.getState(editor.getState())?.changeSet.pending ?? []).map((c) => c.id), rejected: [] });

  it("after a split is accepted, rewriting the second block leaves the first alone", () => {
    const { editor, ai } = build([para("a", "Alpha Beta")]);
    editor.applyTransaction(editor.getState().tr.split(7));
    acceptAll(editor, ai);
    const [first, second] = ai.getRichBlocks();
    if (!first || !second) throw new Error("two blocks");
    expect(ai.applyRichEdit([first, rewrite(second, "Gamma")]).changed).toEqual([second.id]);
    expect(ai.getRichBlocks().map((u) => u.text)).toEqual(["Alpha ", "Gamma"]);
  });

  it("an edit pinned to the second block's hash is checked against, and written to, that block", () => {
    const { editor, ai } = build([para("a", "Alpha Beta")]);
    editor.applyTransaction(editor.getState().tr.split(7));
    acceptAll(editor, ai);
    const second = ai.getRichBlocks()[1];
    if (!second) throw new Error("two blocks");
    const result = ai.applyRichEdit([{ nodeId: second.id, spans: [{ text: "Delta", marks: [] }], expectedContentHash: unitRichHash(second) }]);
    expect(result.stale).toEqual([]);
    expect(ai.getRichBlocks().map((u) => u.text)).toEqual(["Alpha ", "Delta"]);
  });

  it("a caption written under the paragraph split off an image goes there, not onto the image", () => {
    const { editor, ai } = build([{ type: "paragraph", attrs: { nodeId: "fig" }, content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "A" } }] }]);
    editor.applyTransaction(editor.getState().tr.split(2));
    acceptAll(editor, ai);
    const [image, caption] = ai.getRichBlocks();
    if (!image || !caption) throw new Error("two blocks");
    expect(image.type).toBe("image");
    expect(ai.applyRichEdit([{ nodeId: caption.id, spans: [{ text: "Caption", marks: [] }] }]).changed).toEqual([caption.id]);
    expect(ai.getRichBlocks().map((u) => [u.type, u.text])).toEqual([["image", ""], ["paragraph", "Caption"]]);
  });

  it("in a document saved with a deleted and a live copy of one id, handing back only the live one edits it", () => {
    const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta")]);
    editor.applyTransaction(editor.getState().tr.delete(0, editor.getState().doc.child(0).nodeSize));
    const live = ai.getRichBlocks()[1];
    if (!live) throw new Error("two units");
    expect(ai.applyRichEdit([rewrite(live, "Gamma")]).changed).toEqual(["p"]);
    expect(ai.getRichBlocks().map((u) => u.text)).toEqual(["", "Gamma"]);
  });

  it("in a document saved with two live copies of one id, a rich edit by that id is refused, not guessed", () => {
    const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta"), para("z", "z")]);
    const read = ai.getRichBlocks();
    const [first] = read;
    if (!first) throw new Error("units");
    const before = editor.getState().doc;
    expect(ai.applyRichEdit(read)).toMatchObject({ applied: false, changed: [] });
    expect(editor.getState().doc.eq(before)).toBe(true);
    const result = ai.applyRichEdit([rewrite(first, "Alpha2"), ...read.slice(1)]);
    expect(result).toMatchObject({ applied: false, changed: [], rejected: ["p"] });
    expect(editor.getState().doc.eq(before)).toBe(true);
  });

  it("…and so is every structural op that names or anchors on that id", () => {
    const ops = [
      { kind: "structural", op: "moveBlock", nodeId: "p", position: "after", anchorNodeId: "z" },
      { kind: "structural", op: "moveBlock", nodeId: "z", position: "before", anchorNodeId: "p" },
      { kind: "structural", op: "deleteBlock", nodeId: "p" },
      { kind: "structural", op: "insertBlock", anchorNodeId: "p", position: "after", block: { type: "paragraph", spans: [{ text: "New", marks: [] }] } },
    ] satisfies Parameters<ReturnType<typeof build>["ai"]["applySemanticEdits"]>[0];
    for (const op of ops) {
      const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta"), para("z", "z")]);
      const before = editor.getState().doc;
      const result = ai.applySemanticEdits([op], { authorID: "bob" });
      expect(result.rejected).toEqual(["p"]);
      expect(editor.getState().doc.eq(before)).toBe(true);
    }
  });
});

describe("the copy a move leaves behind", () => {
  it("is left out by where it is, not by its id: a deleted block sharing the id stays", () => {
    const { editor, ai } = build([para("p", "Alpha"), para("p", "Beta"), para("z", "z")]);
    editor.applyTransaction(editor.getState().tr.delete(0, editor.getState().doc.child(0).nodeSize));
    const doc = editor.getState().doc;
    const betaAt = doc.child(0).nodeSize;
    const beta = doc.child(1);
    editor.applyTransaction(editor.getState().tr.insert(doc.content.size, beta).delete(betaAt, betaAt + beta.nodeSize));
    expect(ai.getRichBlocks().map((u) => [u.text, u.proposedForDeletion ?? false])).toEqual([
      ["", true],
      ["z", false],
      ["Beta", false],
    ]);
  });
});

describe("an agent's move, undone and redone", () => {
  it("keeps the moved block editable by its id", () => {
    const { editor, ai } = build([para("a", "Alpha"), para("b", "Beta")]);
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "a", position: "after", anchorNodeId: "b" }], { authorID: "bot" });
    undo(editor.getState(), (tr) => editor.applyTransaction(tr));
    redo(editor.getState(), (tr) => editor.applyTransaction(tr));
    const moved = ai.getRichBlocks().find((u) => u.id === "a");
    if (!moved) throw new Error("moved block");
    const result = ai.applyRichEdit([{ ...moved, text: "Alpha2", spans: [{ text: "Alpha2", marks: [] }] }]);
    expect(result).toMatchObject({ changed: ["a"], rejected: [] });
  });
});

describe("ai.reviewChanges", () => {
  it("decides an act by an id the agent read", () => {
    const { editor, ai } = replaceThirty();
    const added = unitOf(ai.getRichBlocks(), "p").changes?.find((c) => c.type === "suggestedInsert");
    const outcome = ai.reviewChanges({ accepted: [added?.id ?? ""], rejected: [] });
    expect(outcome.status).toBe("applied");
    expect(pendingCount(editor)).toBe(0);
    const unit = unitOf(ai.getRichBlocks(), "p");
    expect(unit.text).toBe("The fee is due in 45 days.");
    expect(unit.changes).toBeUndefined();
  });

  it("passes the engine's refusals through", () => {
    const refused = build([para("p", "x")], false);
    expect(refused.ai.reviewChanges({ accepted: ["nope"], rejected: [] })).toMatchObject({ status: "blocked", reason: "not-permitted" });
    const { ai } = replaceThirty();
    expect(ai.reviewChanges({ accepted: ["nope"], rejected: [] })).toMatchObject({ status: "blocked", reason: "missing-changes" });
  });
});
