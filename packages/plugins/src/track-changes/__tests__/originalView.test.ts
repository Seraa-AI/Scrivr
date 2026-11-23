/**
 * The original view is the document as agreed before any pending proposal:
 * what the engine's own Reject would leave. It reads the same for every kind of
 * record — text, formatting, a block's attributes and type, an inserted or
 * deleted block, a move — because it is the engine's reject, run on a copy.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { findChanges } from "../findChanges";
import { reviewChanges } from "../reviewChanges";

function tracked(content: unknown[]) {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content },
  });
}
const p = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });
const read = (editor: ServerEditor, view?: "proposed" | "original") =>
  toSemanticUnits(editor, { groupBlocks: false, ...(view ? { view } : {}) });

describe("the original view", () => {
  it("reads text as it was before a pending rewrite", () => {
    const editor = tracked([p("a", "keep this remove that")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 1));
    editor.applyTransaction(editor.getState().tr.delete(15, 26));

    expect(read(editor)[0]?.text).toBe("NEW keep this ");
    const [original] = read(editor, "original");
    expect(original?.text).toBe("keep this remove that");
    expect(original?.view).toBe("original");
    expect(original?.changes).toBeUndefined();
  });

  it("reads a block's type as it was before a pending heading change", () => {
    const editor = tracked([p("a", "Title")]);
    editor.applyTransaction(editor.getState().tr.setBlockType(1, 6, editor.schema.nodes["heading"]!, { level: 1 }));

    expect(read(editor)[0]?.type).toBe("heading");
    expect(read(editor, "original")[0]?.type).toBe("paragraph");
  });

  it("leaves out a block proposed for insertion, and keeps one proposed for deletion", () => {
    const editor = tracked([p("a", "first"), p("b", "second")]);
    const inserted = editor.schema.nodes["paragraph"]!.create({ nodeId: "new" }, editor.schema.text("added"));
    editor.applyTransaction(editor.getState().tr.insert(0, inserted));
    const second = editor.getState().doc.child(2);
    const at = editor.getState().doc.content.size - second.nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(at, at + second.nodeSize));

    expect(read(editor, "original").map((u) => u.text)).toEqual(["first", "second"]);
  });

  it("is the proposed view when nothing is pending", () => {
    const editor = tracked([p("a", "settled")]);
    expect(read(editor, "original").map((u) => u.text)).toEqual(read(editor).map((u) => u.text));
  });

  it("leaves the live document as it was", () => {
    const editor = tracked([p("a", "keep")]);
    editor.applyTransaction(editor.getState().tr.insertText("NEW ", 1));
    const before = editor.getState().doc;
    read(editor, "original");
    expect(editor.getState().doc).toBe(before);
  });
});

describe("a record missing its bookkeeping fields", () => {
  // As a host's stored or converted document may carry it: who and what, but
  // not when it was made or reviewed. Loading it writes nothing, so it is read
  // as it is.
  const record = (id: string, operation: "insert" | "delete") => ({ dataTracked: { id, authorID: "bob", operation, status: "pending" } });
  const incomplete = () => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "a" }, content: [
      { type: "text", text: "keep " },
      { type: "text", text: "added ", marks: [{ type: "trackedInsert", attrs: record("i1", "insert") }] },
      { type: "text", text: "removed ", marks: [{ type: "trackedDelete", attrs: record("d1", "delete") }] },
      { type: "text", text: "end" },
    ] }] },
  });

  it("is undone by the original view, as the proposed view applies it", () => {
    const editor = incomplete();
    expect(read(editor)[0]?.text).toBe("keep added end");
    expect(read(editor, "original")[0]?.text).toBe("keep removed end");
  });

  it("can be decided as soon as the document is loaded", () => {
    const editor = incomplete();
    expect(reviewChanges(editor, { accepted: ["i1", "d1"], rejected: [] }).status).toBe("applied");
    expect(editor.getState().doc.textContent).toBe("keep added end");
  });

  it("is listed pending, as both views read it", () => {
    const pending = findChanges(incomplete().getState()).pending.map((change) => change.id).sort();
    expect(pending).toEqual(["d1", "i1"]);
  });

  it("gets its bookkeeping on the next edit, under the same id", () => {
    const editor = incomplete();
    editor.applyTransaction(editor.getState().tr.insertText("x", editor.getState().doc.content.size - 1));
    const records = findChanges(editor.getState()).pending.filter((change) => change.id === "i1" || change.id === "d1");
    expect(records.map((change) => change.id).sort()).toEqual(["d1", "i1"]);
    expect(records.every((change) => typeof change.dataTracked.createdAt === "number" && typeof change.dataTracked.updatedAt === "number")).toBe(true);
  });

  it("reads in the proposed view's markdown as applied", () => {
    expect(read(incomplete())[0]?.markdown).toBe("keep added end");
  });
});
