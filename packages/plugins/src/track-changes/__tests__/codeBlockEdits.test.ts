import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { reviewChanges, trackChangesPluginKey } from "../index";

/**
 * A code block forbids formatting, not review: an edit inside one is recorded
 * like an edit anywhere else, and reviewed the same way.
 */

const build = () =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
        { type: "paragraph", content: [{ type: "text", text: "tail" }] },
      ],
    },
  });

const pending = (editor: ServerEditor) =>
  trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;
const code = (editor: ServerEditor) => editor.getState().doc.firstChild!.textContent;

describe("edits inside a code block", () => {
  it("records typing as an insertion", () => {
    const editor = build();
    editor.applyTransaction(editor.getState().tr.insertText("2", 6));

    expect(code(editor)).toBe("x = 12");
    expect(pending(editor).map(c => c.dataTracked.operation)).toEqual(["insert"]);
    expect(() => editor.getState().doc.check()).not.toThrow();
  });

  it("records deleting as a proposed deletion, kept until reviewed", () => {
    const editor = build();
    editor.applyTransaction(editor.getState().tr.delete(5, 6));

    expect(code(editor)).toBe("x = 1");
    const [deletion] = pending(editor);
    expect(deletion?.dataTracked.operation).toBe("delete");

    reviewChanges(editor, { accepted: [deletion!.id], rejected: [] });
    expect(code(editor)).toBe("x = ");
  });

  it("folds typing into a code block the author inserted", () => {
    const editor = build();
    const block = editor.schema.node("codeBlock", null, editor.schema.text("y"));
    editor.applyTransaction(editor.getState().tr.insert(0, block));
    editor.applyTransaction(editor.getState().tr.insertText("z", 2));

    expect(editor.getState().doc.firstChild!.textContent).toBe("yz");
    const creation = pending(editor).find(c => c.type === "node-change")!;
    reviewChanges(editor, { accepted: [], rejected: [creation.id] });
    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc.childCount).toBe(2);
  });
});
