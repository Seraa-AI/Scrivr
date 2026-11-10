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

describe("the units a hash is judged against are the units the agent read", () => {
  const para = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });
  const item = (itemId: string, textId: string, text: string) => ({ type: "listItem", attrs: { nodeId: itemId }, content: [para(textId, text)] });
  function editorWith(content: unknown[]) {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: { type: "doc", content },
    });
    return { editor, ai: getAiToolkit(editor)! };
  }
  const readHash = (ai: ReturnType<typeof editorWith>["ai"], id: string) => unitRichHash(ai.getRichBlocks().find((u) => u.id === id)!);

  it("judges a block moved up by its live copy, not the copy the move left behind", () => {
    const { ai } = editorWith([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "c", anchorNodeId: "a", position: "before" }]);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "insertBlock", anchorNodeId: "c", position: "after", block: newBlock, anchorContentHash: readHash(ai, "c") }]);
    expect(res.stale).toEqual([]);
    expect(res.changed).toEqual(["c"]);
  });

  it("judges a list by the parts the agent read after an item moved", () => {
    const { ai } = editorWith([{ type: "bulletList", attrs: { nodeId: "L" }, content: [item("i1", "q1", "one"), item("i2", "q2", "two"), item("i3", "q3", "three")] }]);
    ai.applySemanticEdits([{ kind: "structural", op: "moveListItem", nodeId: "i1", anchorNodeId: "i3", position: "after" }]);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "i2", expectedContentHash: readHash(ai, "L") }]);
    expect(res.stale).toEqual([]);
    expect(res.changed).toEqual(["i2"]);
  });

  it("judges a list that has no id of its own by the id the agent read", () => {
    const { ai } = editorWith([{ type: "bulletList", content: [item("i1", "q1", "one"), item("i2", "q2", "two")] }]);
    const [list] = ai.getRichBlocks();
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "i2", expectedContentHash: unitRichHash(list!) }]);
    expect(res.stale).toEqual([]);
    expect(res.changed).toEqual(["i2"]);
  });

  it("reports an id the document does not hold as not found, though it carries a hash", () => {
    const { ai } = editorWith([para("a", "alpha")]);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "zz", expectedContentHash: "anything" }]);
    expect(res.stale).toEqual([]);
    expect(res.notFound).toEqual(["zz"]);
  });

  it("names a stale id once, however many ops carry it", () => {
    const { editor, ai } = editorWith([para("a", "alpha"), para("b", "beta")]);
    const read = readHash(ai, "a");
    editor.applyTransaction(editor.getState().tr.insertText("x", 2));
    const res = ai.applySemanticEdits([
      { kind: "structural", op: "deleteBlock", nodeId: "a", expectedContentHash: read },
      { kind: "structural", op: "insertBlock", anchorNodeId: "a", position: "after", block: newBlock, anchorContentHash: read },
    ]);
    expect(res.stale).toEqual(["a"]);
  });
});

describe("the copy a move leaves behind", () => {
  const para = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });

  it("is not a proposed deletion: an op on its id that cannot act is rejected", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u2", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: { type: "doc", content: [para("a", "alpha"), para("b", "beta"), para("c", "gamma")] },
    });
    const ai = getAiToolkit(editor)!;
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "c", position: "after" }]);
    const res = ai.applySemanticEdits([
      { kind: "structural", op: "deleteListItem", nodeId: "a" },
      { kind: "structural", op: "insertListItem", anchorNodeId: "a", position: "after", item: { spans: [{ text: "x", marks: [] }] } },
    ]);
    expect(res.alreadyProposed).toEqual([]);
    expect(res.anchorProposedForDeletion).toEqual([]);
    expect(res.rejected).toEqual(["a", "a"]);
  });
});
