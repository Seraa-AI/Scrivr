import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { findChanges } from "../findChanges";

/**
 * Markdown has no tracked changes of its own, so pending ones are written as
 * CriticMarkup — the text a suggestion adds or removes stays readable, and
 * serializing a document someone is still reviewing does not fail.
 */
describe("a document with pending changes as markdown", () => {
  const suggesting = () => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "keep this word" }] }] },
  });

  it("writes a proposed insertion and deletion as CriticMarkup", () => {
    const editor = suggesting();
    editor.applyTransaction(editor.getState().tr.insertText("new ", 6));
    const word = editor.getState().doc.textContent.indexOf("word") + 1;
    editor.applyTransaction(editor.getState().tr.delete(word, word + 4));

    expect(editor.getMarkdown().trim()).toBe("keep {++new ++}this {--word--}");
  });

  it("writes plain markdown once every change is decided", () => {
    const editor = suggesting();
    editor.applyTransaction(editor.getState().tr.insertText("new ", 6));
    editor.commands.setChangeStatuses("accepted", findChanges(editor.getState()).pending.map(change => change.id));

    expect(editor.getMarkdown().trim()).toBe("keep new this word");
  });
});
