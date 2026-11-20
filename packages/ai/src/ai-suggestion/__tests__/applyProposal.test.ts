/**
 * Applying an AI suggestion is one plain transaction: its formatting and its
 * words together, recorded by track changes in tracked mode, and not written at
 * all where they would not be recorded.
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { undo } from "@scrivr/core/pm";
import { changeActs, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../../ai-toolkit/AiToolkit";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { applyAiSuggestion, showAiSuggestion } from "../showHideApply";
import { aiSuggestionPluginKey } from "../AiSuggestionPlugin";
import type { InlineSpan } from "../../schema/edit";

const build = (text: string, tracking = true) => new ServerEditor({
  extensions: tracking
    ? [StarterKit, TrackChanges.configure({ userID: "human", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }), AiToolkit]
    : [StarterKit, AiToolkit],
  content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text }] }] },
});
const propose = (editor: ServerEditor, spans: InlineSpan[]) => {
  showAiSuggestion(editor, computeAiSuggestion(editor.getState(), { authorID: "AI", blocks: [{ nodeId: "p", proposedSpans: spans }] }));
};
/** The paragraph's text, with each break as "□". */
const laidOut = (editor: ServerEditor) => {
  const paragraph = editor.getState().doc.child(0);
  return paragraph.textBetween(0, paragraph.content.size, "", "□");
};

describe("applying an AI suggestion", () => {
  it("is one undo step, formatting and words together", () => {
    const editor = build("term old");
    const before = editor.getState().doc.toJSON();
    propose(editor, [{ text: "term", marks: [{ type: "bold" }] }, { text: " new", marks: [] }]);

    const dispatched = vi.spyOn(editor, "applyTransaction");
    expect(applyAiSuggestion(editor, { mode: "tracked" })).toBe(true);
    expect(dispatched.mock.calls.filter(([tr]) => tr.docChanged)).toHaveLength(1);
    const recorded = trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;
    expect(recorded.some((change) => change.type === "text-change")).toBe(true);
    expect(recorded.some((change) => change.type !== "text-change")).toBe(true);

    undo(editor.getState(), (tr) => editor.applyTransaction(tr));
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });

  it("writes nothing in tracked mode without track changes", () => {
    const editor = build("teh cat", false);
    const before = editor.getState().doc;
    propose(editor, [{ text: "the cat", marks: [] }]);

    expect(applyAiSuggestion(editor, { mode: "tracked" })).toBe(false);
    expect(editor.getState().doc).toBe(before);
    expect(aiSuggestionPluginKey.getState(editor.getState())?.suggestion).not.toBeNull();
  });

  it("writes nothing in tracked mode while snapshots are viewed", () => {
    const editor = build("teh cat");
    propose(editor, [{ text: "the cat", marks: [] }]);
    editor.commands.setTrackingStatus(TrackChangesStatus.viewSnapshots);
    const before = editor.getState().doc;

    expect(applyAiSuggestion(editor, { mode: "tracked" })).toBe(false);
    expect(editor.getState().doc).toBe(before);
    expect(aiSuggestionPluginKey.getState(editor.getState())?.suggestion).not.toBeNull();
  });

  it("records a word swap as one act", () => {
    const editor = build("The policy applys to all.");
    propose(editor, [{ text: "The policy applies to all.", marks: [] }]);
    applyAiSuggestion(editor, { mode: "tracked" });

    expect(changeActs(trackChangesPluginKey.getState(editor.getState())!.changeSet.pending)).toHaveLength(1);
  });

  it.each(["direct", "tracked"] as const)("writes a line break as a break in %s mode", (mode) => {
    const editor = build("one two");
    propose(editor, [{ text: "one\ntwo", marks: [] }]);
    applyAiSuggestion(editor, { mode });
    if (mode === "tracked") {
      const ids = trackChangesPluginKey.getState(editor.getState())!.changeSet.pending.map((change) => change.id);
      editor.commands.setChangeStatuses("accepted", ids);
    }

    expect(laidOut(editor)).toBe("one□two");
  });
});
