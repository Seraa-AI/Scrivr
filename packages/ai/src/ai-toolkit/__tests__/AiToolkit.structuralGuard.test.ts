/**
 * A structural op is computed against the document an agent read. When what it
 * targets or anchors to has changed since, it is reported stale and writes
 * nothing, as a rich edit is. Review state is answered too: a block already
 * proposed for deletion is not deleted twice, nor anchored to.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { unitRichHash } from "@scrivr/export-semantic";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";

function build() {
  const p = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
    content: { type: "doc", content: [p("p1", "first clause"), p("p2", "second clause")] },
  });
  return { editor, ai: getAiToolkit(editor)! };
}
const hashOf = (ai: ReturnType<typeof build>["ai"], id: string) => unitRichHash(ai.getRichBlocks().find((u) => u.id === id)!);
const pending = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())!.changeSet.pending.length;
const newBlock = { type: "paragraph" as const, spans: [{ text: "inserted", marks: [] }] };

describe("a structural op's hashes", () => {
  it("apply when what they name is as the agent read it", () => {
    const { ai } = build();
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "p2", expectedContentHash: hashOf(ai, "p2") }]);
    expect(res.changed).toEqual(["p2"]);
  });

  it("report a target edited since as stale, and write nothing", () => {
    const { editor, ai } = build();
    const read = hashOf(ai, "p2");
    editor.applyTransaction(editor.getState().tr.insertText("amended ", 15));
    const before = editor.getState().doc;
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "p2", expectedContentHash: read }]);
    expect(res.stale).toEqual(["p2"]);
    expect(editor.getState().doc).toBe(before);
  });

  it("report an anchor edited since as stale", () => {
    const { editor, ai } = build();
    const read = hashOf(ai, "p1");
    editor.applyTransaction(editor.getState().tr.insertText("amended ", 1));
    const res = ai.applySemanticEdits([{ kind: "structural", op: "insertBlock", anchorNodeId: "p1", position: "after", block: newBlock, anchorContentHash: read }]);
    expect(res.stale).toEqual(["p1"]);
    expect(res.changed).toEqual([]);
  });
});

describe("review state", () => {
  function withP2ProposedForDeletion() {
    const built = build();
    const { editor } = built;
    const p2 = editor.getState().doc.child(1);
    const at = editor.getState().doc.child(0).nodeSize;
    editor.applyTransaction(editor.getState().tr.delete(at, at + p2.nodeSize));
    return built;
  }

  it("does not delete a block another author already proposed for deletion", () => {
    const { editor, ai } = withP2ProposedForDeletion();
    const before = pending(editor);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "p2" }]);
    expect(res.alreadyProposed).toEqual(["p2"]);
    expect(pending(editor)).toBe(before);
  });

  it("refuses to anchor to a block proposed for deletion", () => {
    const { editor, ai } = withP2ProposedForDeletion();
    const before = editor.getState().doc;
    const res = ai.applySemanticEdits([{ kind: "structural", op: "insertBlock", anchorNodeId: "p2", position: "after", block: newBlock }]);
    expect(res.anchorProposedForDeletion).toEqual(["p2"]);
    expect(editor.getState().doc).toBe(before);
  });
});
