/**
 * A card's preview of a block change reads as the block will read: a block
 * moved or added shows its words without those proposed for deletion inside
 * it, and a block removed or moved away shows them without those proposed for
 * insertion — never both run together.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { findChanges } from "../findChanges";
import { applyRichDiffAsSuggestion } from "../lib/applyRichDiffAsSuggestion";
import { changeAtCaret, changePreviewText, conflictAt } from "../createChangePopover";

function movedAndRewritten() {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: [
      { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "In conclusion, this policy is fair." }] },
      { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "Tail." }] },
    ] },
  });
  applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
    edits: [{ nodeId: "a", spans: [{ text: "This policy is fair.", marks: [] }] }],
    authorID: "agent",
  });
  const first = editor.getState().doc.child(0);
  const tr = editor.getState().tr.delete(0, first.nodeSize);
  editor.applyTransaction(tr.insert(tr.doc.content.size, first));
  return editor;
}

describe("the preview of a block change", () => {
  it("reads as the block will, where it went", () => {
    const editor = movedAndRewritten();
    const { pending } = findChanges(editor.getState());
    const halves = pending.filter((c) => c.type === "node-change" && c.dataTracked.moveNodeId);
    expect(halves).toHaveLength(2);
    for (const half of halves) {
      expect(changePreviewText(editor.getState().doc, half, pending)).toBe("This policy is fair.");
    }
  });

  it("reads as the block did, for a block proposed for deletion", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "reviewer", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "In conclusion, this policy is fair." }] },
        { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "Tail." }] },
      ] },
    });
    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      edits: [{ nodeId: "a", spans: [{ text: "This policy is fair.", marks: [] }] }],
      authorID: "agent",
    });
    editor.applyTransaction(editor.getState().tr.delete(0, editor.getState().doc.child(0).nodeSize));

    const { pending } = findChanges(editor.getState());
    const deleted = pending.find((c) => c.type === "node-change" && c.dataTracked.operation === "delete");
    if (!deleted) throw new Error("no block deletion");
    expect(changePreviewText(editor.getState().doc, deleted, pending)).toBe("In conclusion, this policy is fair.");
  });
});

describe("the change a popover shows at the caret", () => {
  const cell = (text: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const row = (...texts: string[]) => ({ type: "tableRow", content: texts.map(cell) });
  const inTable = (author: string) => new ServerEditor({
    extensions: [StarterKit.configure({ table: true }), TrackChanges.configure({ userID: author, initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: [{ type: "table", attrs: { layout: "fixed", grid: [] }, content: [row("a", "b"), row("c", "d")] }] },
  });
  const caretIn = (editor: ServerEditor, text: string) => {
    let at = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text === text) at = pos;
      return at < 0;
    });
    return at;
  };
  const named = (editor: ServerEditor, text: string) => {
    const change = changeAtCaret(findChanges(editor.getState()).pending, caretIn(editor, text));
    return change && change.type === "node-change" ? change.node.type.name : change?.type;
  };

  it("is the row, inside a row someone added", () => {
    const editor = inTable("u");
    const table = editor.getState().doc.child(0);
    editor.applyTransaction(editor.getState().tr.insert(1 + table.child(0).nodeSize + table.child(1).nodeSize, editor.getState().schema.nodeFromJSON(row("e", "f"))));
    expect(named(editor, "e")).toBe("tableRow");
  });

  it("is the row, inside a row someone removed", () => {
    const editor = inTable("u");
    editor.applyTransaction(editor.getState().tr.delete(1, 1 + editor.getState().doc.child(0).child(0).nodeSize));
    expect(named(editor, "a")).toBe("tableRow");
  });
});

describe("the card at the caret, in each replacement view", () => {
  const typedOver = () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The cat sat" }] }] },
    });
    editor.applyTransaction(editor.getState().tr.insertText("dog", 5, 8));
    return findChanges(editor.getState()).pending;
  };
  const at = (pending: ReturnType<typeof typedOver>, operation: string) =>
    pending.find((change) => change.dataTracked.operation === operation)!.from + 1;

  it("is the whole replacement when paired", () => {
    const pending = typedOver();
    expect(changeAtCaret(pending, at(pending, "insert"))).toBe(changeAtCaret(pending, at(pending, "delete")));
  });

  it("is the half under the caret when split", () => {
    const pending = typedOver();
    expect(changeAtCaret(pending, at(pending, "insert"), "split")?.dataTracked.operation).toBe("insert");
    expect(changeAtCaret(pending, at(pending, "delete"), "split")?.dataTracked.operation).toBe("delete");
  });
});

describe("the parties to a conflict, in each replacement view", () => {
  it("count a replacement as one party paired, and two split", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The cat sat" }] }] },
    });
    editor.applyTransaction(editor.getState().tr.insertText("dog", 5, 8));
    editor.commands.setTrackChangesUserID("u2");
    editor.applyTransaction(editor.getState().tr.delete(5, 8));
    const { pending } = findChanges(editor.getState());
    const theirs = pending.find((c) => c.dataTracked.authorID === "u2")!;
    const parties = (view: "paired" | "split") =>
      conflictAt(pending, theirs, theirs.from + 1, view)?.parties.map((c) => `${c.dataTracked.authorID}:${c.dataTracked.operation}`).sort();

    expect(parties("paired")).toEqual(["u1:insert", "u2:delete"]);
    expect(parties("split")).toEqual(["u1:delete", "u1:insert", "u2:delete"]);
  });
});
