import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node } from "@scrivr/core/pm";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { reviewChanges, trackChangesPluginKey } from "../index";

/**
 * A tracked record names one contiguous span. Typing inside someone's deletion
 * splits it in two, so each piece gets its own identity — and the pieces stay
 * one change: reviewing either one decides the deletion that was made.
 */

const deletion = (id: string) => ({
  type: "trackedDelete",
  attrs: {
    dataTracked: {
      id,
      authorID: "alice",
      reviewedByID: null,
      operation: "delete",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
      statusUpdateAt: 0,
    },
  },
});

const build = (content?: Record<string, unknown>) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
    ],
    content: content ?? {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
    },
  });

const changeSet = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())!.changeSet;
const pending = (editor: ServerEditor) => changeSet(editor).pending;
const deletions = (editor: ServerEditor) =>
  pending(editor).filter(c => c.dataTracked.operation === "delete");

/** Every tracked-delete record on each text node, in document order. */
const deleteRecords = (doc: Node) => {
  const records: string[][] = [];
  doc.descendants(node => {
    if (!node.isText) return;
    records.push(node.marks.filter(m => m.type.name === "trackedDelete").map(m => m.attrs.dataTracked.id));
  });
  return records;
};

/** Alice deletes "ello wor"; Bob types inside what she deleted. */
const split = () => {
  const editor = build();
  editor.applyTransaction(editor.getState().tr.delete(2, 10));
  editor.commands.setTrackChangesUserID("bob");
  editor.applyTransaction(editor.getState().tr.insertText("!", 6));
  return editor;
};

describe("a record split by later work", () => {
  it("gives each piece its own identity in the same transaction", () => {
    const editor = split();

    expect(changeSet(editor).hasDuplicateIds).toBe(false);
    const pieces = deletions(editor);
    expect(pieces.map(c => editor.getState().doc.textBetween(c.from, c.to))).toEqual(["ello", " wor"]);
    expect(new Set(pieces.map(c => c.id)).size).toBe(2);
  });

  it("is still one change: accepting either piece decides both", () => {
    const editor = split();
    const [, second] = deletions(editor);

    expect(reviewChanges(editor, { accepted: [second!.id], rejected: [] }).status).toBe("applied");

    expect(editor.getState().doc.textContent).toBe("h!ld");
    expect(pending(editor).map(c => c.dataTracked.authorID)).toEqual(["bob"]);
  });

  it("treats a paragraph break inside the deletion as the same split", () => {
    const editor = build();
    editor.applyTransaction(editor.getState().tr.delete(2, 10));
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.split(6));

    expect(changeSet(editor).hasDuplicateIds).toBe(false);
    const [first] = deletions(editor).filter(c => c.type === "text-change");
    expect(reviewChanges(editor, { accepted: [first!.id], rejected: [] }).status).toBe("applied");
    expect(deletions(editor)).toEqual([]);
  });

  it("keeps one record per piece as editing continues", () => {
    const editor = split();
    editor.applyTransaction(editor.getState().tr.insertText("?", editor.getState().doc.content.size - 1));

    expect(deleteRecords(editor.getState().doc).every(ids => ids.length <= 1)).toBe(true);
  });

  it("gives collaborators repairing the same document the same identities", () => {
    // Two pieces already sharing one id, as they arrive from an older client.
    const content = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "h" },
          { type: "text", text: "ello", marks: [deletion("d1")] },
          { type: "text", text: "!" },
          { type: "text", text: " wor", marks: [deletion("d1")] },
          { type: "text", text: "ld" },
        ],
      }],
    };
    const ours = build(content);
    const theirs = build(content);
    for (const editor of [ours, theirs]) {
      editor.applyTransaction(editor.getState().tr.insertText("?", editor.getState().doc.content.size - 1));
    }

    expect(changeSet(ours).hasDuplicateIds).toBe(false);
    expect(deletions(ours).map(c => c.id)).toEqual(deletions(theirs).map(c => c.id));
  });
});
