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
