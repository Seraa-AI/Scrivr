/**
 * An agent reads a hard break as "\n" and writes one the same way. A break it
 * adds is proposed as a break, not lost between the lines it was to separate.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";

function build() {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }), AiToolkit],
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [
        { type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" },
      ] }],
    },
  });
  return { editor, ai: getAiToolkit(editor)! };
}

describe("a hard break in a rich edit", () => {
  it("is read as a newline", () => {
    const { ai } = build();
    expect(ai.getRichBlocks()[0]!.text).toBe("one\ntwo");
  });

  it("is proposed as a break when the edit adds one", () => {
    const { editor, ai } = build();
    const unit = ai.getRichBlocks()[0]!;
    const res = ai.applyRichEdit([{ ...unit, spans: [{ text: "one\ntwo\nthree", marks: [] }], text: "one\ntwo\nthree" }]);
    expect(res.applied).toBe(true);

    // Text is proposed through a mark; a break, an atom, through its own record.
    const inline: string[] = [];
    editor.getState().doc.firstChild!.forEach((node) => {
      const records: unknown = node.attrs["dataTracked"];
      const ownRecord = Array.isArray(records) && records.length > 0;
      const proposed = ownRecord || node.marks.some((m) => m.type.name === "trackedInsert") ? "+" : "";
      inline.push(proposed + (node.isText ? node.text! : node.type.name));
    });
    expect(inline).toEqual(["one", "hardBreak", "two", "+hardBreak", "+three"]);
  });

  it("goes with the rest of the suggestion when it is rejected", () => {
    const { editor, ai } = build();
    const before = editor.getState().doc.toJSON();
    const unit = ai.getRichBlocks()[0]!;
    ai.applyRichEdit([{ ...unit, spans: [{ text: "one\ntwo\nthree", marks: [] }], text: "one\ntwo\nthree" }]);
    const ids = trackChangesPluginKey.getState(editor.getState())!.changeSet.changes.map((change) => change.id);
    editor.commands.setChangeStatuses("rejected", ids);
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });
});
