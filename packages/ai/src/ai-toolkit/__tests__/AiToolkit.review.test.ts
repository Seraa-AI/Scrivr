/**
 * An agent reads pending changes through `getRichBlocks` and decides them
 * through `reviewChanges`, by the ids it read.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { SemanticUnit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit, getAiToolkit } from "../../index";

type DocNode = Record<string, unknown>;

const para = (nodeId: string, text: string): DocNode => ({
  type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }],
});

function build(content: DocNode[], canAcceptReject = true) {
  const editor = new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "jane", initialStatus: TrackChangesStatus.enabled, canAcceptReject }),
      AiToolkit,
    ],
    content: { type: "doc", content },
  });
  const ai = getAiToolkit(editor);
  if (!ai) throw new Error("no AiToolkit");
  return { editor, ai };
}

function unitOf(units: SemanticUnit[], id: string): SemanticUnit {
  const unit = units.find((u) => u.id === id);
  if (!unit) throw new Error(`no unit ${id}`);
  return unit;
}

const pendingCount = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.length ?? 0;

function replaceThirty() {
  const built = build([para("p", "The fee is due in 30 days.")]);
  built.ai.applyRichEdit([{ nodeId: "p", spans: [{ text: "The fee is due in 45 days.", marks: [] }] }]);
  return built;
}

describe("an agent reads a replacement", () => {
  it("as a deletion and an insertion, placed, attributed and paired", () => {
    const { ai } = replaceThirty();
    const unit = unitOf(ai.getRichBlocks(), "p");
    expect(unit.text).toBe("The fee is due in 45 days.");
    const removed = unit.changes?.find((c) => c.type === "suggestedDelete");
    const added = unit.changes?.find((c) => c.type === "suggestedInsert");
    expect(removed).toMatchObject({ text: "30", at: 18, length: 0, authorId: "AI Assistant" });
    expect(added).toMatchObject({ text: "45", at: 18, length: 2, authorId: "AI Assistant" });
    expect(removed?.id).toBeDefined();
    expect(added?.id).toBeDefined();
    expect(added?.groupId).toBeDefined();
    expect(added?.groupId).toBe(removed?.groupId);
  });
});

describe("an agent sees structural changes", () => {
  it("keeps a block proposed for deletion, with nothing left to read but its deletion", () => {
    const { editor, ai } = build([para("a", "Alpha"), para("b", "Beta"), para("c", "Gamma")]);
    editor.applyTransaction(editor.getState().tr.delete(7, 13));
    const unit = unitOf(ai.getRichBlocks(), "b");
    expect(unit.text).toBe("");
    expect(unit.changes?.map((c) => [c.type, c.text])).toEqual([["suggestedDelete", "Beta"]]);
    const result = ai.applyRichEdit([{ nodeId: "b", spans: [{ text: "Revived", marks: [] }] }]);
    expect(result.changed).toEqual([]);
  });

  it("reads a moved block once, where it went", () => {
    const { editor, ai } = build([para("a", "Alpha"), para("b", "Beta"), para("c", "Gamma")]);
    const state = editor.getState();
    const moved = state.doc.child(0);
    editor.applyTransaction(state.tr.insert(state.doc.content.size, moved).delete(0, moved.nodeSize));
    const units = ai.getRichBlocks();
    expect(units.map((u) => u.id)).toEqual(["b", "c", "a"]);
    expect(unitOf(units, "a").changes?.[0]).toMatchObject({ type: "suggestedInsert", text: "Alpha" });
  });

  it("does not read a returned unit as an edit because it left out the changes", () => {
    const { ai } = replaceThirty();
    const units = ai.getRichBlocks().map(({ changes: _changes, ...unit }) => unit);
    expect(ai.applyRichEdit(units).changed).toEqual([]);
  });
});

describe("ai.reviewChanges", () => {
  it("decides an act by an id the agent read", () => {
    const { editor, ai } = replaceThirty();
    const added = unitOf(ai.getRichBlocks(), "p").changes?.find((c) => c.type === "suggestedInsert");
    const outcome = ai.reviewChanges({ accepted: [added?.id ?? ""], rejected: [] });
    expect(outcome.status).toBe("applied");
    expect(pendingCount(editor)).toBe(0);
    const unit = unitOf(ai.getRichBlocks(), "p");
    expect(unit.text).toBe("The fee is due in 45 days.");
    expect(unit.changes).toBeUndefined();
  });

  it("passes the engine's refusals through", () => {
    const refused = build([para("p", "x")], false);
    expect(refused.ai.reviewChanges({ accepted: ["nope"], rejected: [] })).toMatchObject({ status: "blocked", reason: "not-permitted" });
    const { ai } = replaceThirty();
    expect(ai.reviewChanges({ accepted: ["nope"], rejected: [] })).toMatchObject({ status: "blocked", reason: "missing-changes" });
  });
});
