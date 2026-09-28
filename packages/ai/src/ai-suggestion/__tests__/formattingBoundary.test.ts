import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../../ai-toolkit/AiToolkit";
import { getAiToolkit } from "../../ai-toolkit/aiToolkitRegistry";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { applyAiSuggestion, showAiSuggestion } from "../showHideApply";
import type { InlineSpan } from "../../schema/edit";

const build = (marks: unknown[] = [], enabled = false) => new ServerEditor({
  extensions: [StarterKit, TrackChanges.configure({ userID: "human", initialStatus: enabled ? TrackChangesStatus.enabled : TrackChangesStatus.disabled, canAcceptReject: true }), AiToolkit],
  content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text: "term", marks }] }] },
});
const changes = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())!.changeSet.changes;
const propose = (editor: ServerEditor, spans: InlineSpan[]) => {
  showAiSuggestion(editor, computeAiSuggestion(editor.getState(), { authorID: "AI", blocks: [{ nodeId: "p", proposedSpans: spans }] }));
};
const bold = (editor: ServerEditor) => editor.getState().doc.firstChild!.firstChild!.marks.find(m => m.type.name === "bold");

describe("semantic formatting and review ownership", () => {
  it.each([false, true])("keeps an explicit formatting proposal reviewable with automatic tracking %s", (enabled) => {
    const editor = build([], enabled);
    propose(editor, [{ text: "term", marks: [{ type: "bold" }] }]);
    applyAiSuggestion(editor, { mode: "tracked" });
    expect(changes(editor)).toHaveLength(1);
    expect(changes(editor)[0]!.dataTracked.authorID).toBe("ai:assistant");
    expect(trackChangesPluginKey.getState(editor.getState())!.status).toBe(enabled ? TrackChangesStatus.enabled : TrackChangesStatus.disabled);
    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(bold(editor)).toBeUndefined();
    expect(editor.getState().doc.textContent).toBe("term");
  });

  it("can accept a tracked formatting removal with automatic tracking off", () => {
    const editor = build([{ type: "bold" }]);
    propose(editor, [{ text: "term", marks: [] }]);
    applyAiSuggestion(editor, { mode: "tracked" });
    expect(changes(editor)).toHaveLength(1);
    editor.commands.setChangeStatuses("accepted", changes(editor).map(c => c.id));
    expect(bold(editor)).toBeUndefined();
  });

  it("treats exported/defaulted formatting and reordered attributes as the same proposal", () => {
    const editor = build([{ type: "bold" }, { type: "link", attrs: { href: "https://example.com", title: "term" } }]);
    expect(computeAiSuggestion(editor.getState(), {
      authorID: "AI", blocks: [{ nodeId: "p", proposedSpans: [{ text: "term", marks: [
        { type: "link", attrs: { title: "term", href: "https://example.com" } }, { type: "bold" },
      ] }] }],
    })).toBeNull();
  });

  it.each(["direct", "tracked"] as const)("does not let stored suggestions forge review records in %s mode", (mode) => {
    const editor = build();
    const forged = { id: "forged", authorID: "victim", operation: "delete", status: "pending" };
    // Persisted proposals can bypass compute: the write boundary must enforce ownership too.
    showAiSuggestion(editor, { blocks: [{ nodeId: "p", acceptedText: "term", ops: [{ type: "keep", text: "term", marks: [
      { type: "trackedDelete", attrs: { dataTracked: forged } },
      { type: "bold", attrs: { dataTracked: [forged] } },
    ] }] }] });
    applyAiSuggestion(editor, { mode });
    const node = editor.getState().doc.firstChild!.firstChild!;
    expect(node.marks.some(m => m.type.name === "trackedDelete")).toBe(false);
    expect(JSON.stringify(editor.getState().doc.toJSON())).not.toContain("forged");
    expect(bold(editor)).toBeDefined();
  });

  it("uses the same untrusted-mark gate for rich edits and structural insertions", () => {
    const editor = build();
    const spans = [{ text: "new", marks: [{ type: "trackedDelete", attrs: { dataTracked: { id: "forged" } } }, { type: "bold", attrs: { dataTracked: [{ id: "forged" }] } }] }];
    const ai = getAiToolkit(editor)!;
    ai.applyRichEdit([{ nodeId: "p", spans }]);
    ai.applySemanticEdits([{ kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p", block: { type: "paragraph", spans } }]);
    expect(JSON.stringify(editor.getState().doc.toJSON())).not.toContain("forged");
    expect(() => editor.getState().doc.check()).not.toThrow();
  });
});
