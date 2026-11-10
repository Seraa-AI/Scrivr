/**
 * An agent reads the document as proposed or as originally agreed, and edits
 * only what is proposed: an edit computed against the original would rewrite
 * text other authors have already proposed changes to.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { unitRichHash } from "@scrivr/export-semantic";
import { TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";

function build() {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "agreed terms" }] }] },
  });
  // Another author's pending proposal.
  editor.applyTransaction(editor.getState().tr.insertText("revised ", 1));
  return { editor, ai: getAiToolkit(editor)! };
}

describe("reading a view", () => {
  it("reads the proposed view by default", () => {
    const { ai } = build();
    expect(ai.getRichBlocks().map((u) => [u.view, u.text])).toEqual([["proposed", "revised agreed terms"]]);
  });

  it("reads the original view when asked", () => {
    const { ai } = build();
    expect(ai.getRichBlocks({ view: "original" }).map((u) => [u.view, u.text])).toEqual([["original", "agreed terms"]]);
  });

  it("hashes the two views apart, though their texts may match", () => {
    const settled = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u2" }), AiToolkit],
      content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "same" }] }] },
    });
    const both = getAiToolkit(settled)!;
    expect(unitRichHash(both.getRichBlocks({ view: "original" })[0]!)).not.toBe(unitRichHash(both.getRichBlocks()[0]!));
  });
});

describe("editing a view", () => {
  it("refuses an edit to a unit read in the original view, and writes nothing", () => {
    const { editor, ai } = build();
    const before = editor.getState().doc;
    const [original] = ai.getRichBlocks({ view: "original" });
    const res = ai.applyRichEdit([{ ...original!, text: "agreed terms, amended", spans: [{ text: "agreed terms, amended", marks: [] }] }]);
    expect(res.applied).toBe(false);
    expect(res.wrongView).toEqual(["p1"]);
    expect(editor.getState().doc).toBe(before);
  });

  it("edits a unit handed back without its view, as the proposed one it was read as", () => {
    const { ai } = build();
    // An agent's JSON, with the field it dropped.
    const { view: _dropped, ...rest } = ai.getRichBlocks()[0]!;
    const unit = JSON.parse(JSON.stringify(rest));
    const res = ai.applyRichEdit([{ ...unit, text: "revised agreed terms, amended", spans: [{ text: "revised agreed terms, amended", marks: [] }] }]);
    expect(res.wrongView).toEqual([]);
    expect(res.applied).toBe(true);
  });
});

describe("the original view over a range", () => {
  it("keeps the blocks the range covers, though a pending change rewrapped them", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "one" }] },
        { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "two" }] },
      ] },
    });
    const ai = getAiToolkit(editor)!;
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
    editor.commands.toggleBulletList();
    const whole = ai.getRichBlocks({ view: "original" });
    expect(whole.map((u) => u.text)).toContain("one");
    expect(ai.getRichBlocks({ view: "original", from: 0, to: editor.getState().doc.content.size })).toEqual(whole);
  });
});

