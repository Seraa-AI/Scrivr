/**
 * The diff and preview helpers a host builds its own review on, reached the
 * way a host reaches them: through the package barrel.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import {
  bridgeable, buildAcceptedTextMap, changePreviewText, diffText, findChanges, phraseReplacements,
  proposedForDeletion, TrackChanges, TrackChangesStatus,
} from "../../index";

const editorWith = (text: string) => new ServerEditor({
  extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
  content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text }] }] },
});

describe("the diff helpers, from the barrel", () => {
  it("group a rewrite into phrases a host can bridge with its own document", () => {
    const editor = editorWith("All staff, contractors is covered.");
    const paragraph = editor.getState().doc.child(0);
    const { acceptedText, map } = buildAcceptedTextMap(paragraph, 0, editor.getState().schema);
    const ops = phraseReplacements(diffText(acceptedText, "All staff; contractors are covered."),
      (from, to) => bridgeable(editor.getState().doc, map, from, to));

    expect(ops.filter((op) => op.type !== "keep").map((op) => op.text)).toEqual([", contractors is", "; contractors are"]);
  });

  it("preview a change and tell what is proposed for deletion", () => {
    const editor = editorWith("alpha beta");
    editor.applyTransaction(editor.getState().tr.delete(1, 7));
    const [change] = findChanges(editor.getState()).pending;
    if (!change) throw new Error("no change");

    expect(changePreviewText(editor.getState().doc, change, [change])).toContain("alpha");
    const deleted = editor.getState().doc.child(0).firstChild;
    expect(deleted && proposedForDeletion(deleted)).toBe(true);
  });
});
