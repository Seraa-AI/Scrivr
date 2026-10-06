import { describe, expect, it } from "vitest";
import { trackChangesPluginKey } from "@scrivr/plugins";
import { AiSuggestionsAPI } from "../../ai-toolkit/AiToolkit";
import { AiTestEditor, doc, markedText, p } from "./helpers";

function propose(api: AiSuggestionsAPI, proposedText: string, nodeId = "p") {
  const suggestion = api.compute({ authorID: "AI", blocks: [{ nodeId, proposedText }] });
  expect(suggestion).not.toBeNull();
  api.show(suggestion!);
  return suggestion!;
}

function firstGroup(api: AiSuggestionsAPI) {
  const groupId = api.getCurrent()?.blocks[0]?.ops.find((op) => op.groupId)?.groupId;
  expect(groupId).toBeDefined();
  return groupId!;
}

describe("pending proposals and committed tracked changes", () => {
  for (const scope of ["all", "block", "group"] as const) {
    it(`preserves a prior tracked insertion when rejecting a fresh proposal (${scope})`, () => {
      const editor = new AiTestEditor(doc(p("fox", "p")), "user1", { canAcceptReject: true });
      const api = new AiSuggestionsAPI(editor);
      propose(api, "slow fox");
      api.apply({ mode: "tracked" });
      expect(api.getCurrent()).toBeNull();
      expect(markedText(editor, "trackedInsert")).toBe("slow ");

      propose(api, "very slow fox");
      expect(editor.suggestionState!.staleBlockIds.size).toBe(0);
      const before = editor.getState().doc;
      const changes = trackChangesPluginKey.getState(editor.getState())!.changeSet.changes;
      api.reject(scope === "group" ? { groupId: firstGroup(api) } : scope === "block" ? { blockId: "p" } : undefined);

      expect(editor.getState().doc).toBe(before);
      expect(trackChangesPluginKey.getState(editor.getState())!.changeSet.changes).toEqual(changes);
      // The diff addresses the inserted word and space separately. Rejecting
      // one group leaves the other pending; neither owns the prior insertion.
      if (scope === "group") {
        expect(api.getCurrent()).not.toBeNull();
        api.reject({ groupId: firstGroup(api) });
        expect(editor.getState().doc).toBe(before);
      }
      expect(api.getCurrent()).toBeNull();

      // The committed insertion remains reviewable through its owning API.
      expect(changes.length).toBeGreaterThan(0);
      editor.commands.setChangeStatuses("rejected", changes.map((change) => change.dataTracked.id));
      expect(editor.text).toBe("fox");
      expect(markedText(editor, "trackedInsert")).toBe("");
    });

    it(`preserves a human deletion inside an accepted-text range (${scope})`, () => {
      const editor = new AiTestEditor(doc(p("abcdef", "p")));
      const api = new AiSuggestionsAPI(editor);
      editor.applyTransaction(editor.getState().tr.delete(3, 5));
      expect(markedText(editor, "trackedDelete")).toBe("cd");
      const suggestion = propose(api, "");
      expect(suggestion.blocks[0]!.acceptedText).toBe("abef");
      const before = editor.getState().doc;

      api.reject(scope === "group" ? { groupId: firstGroup(api) } : scope === "block" ? { blockId: "p" } : undefined);

      expect(editor.getState().doc).toBe(before);
      expect(markedText(editor, "trackedDelete")).toBe("cd");
      expect(api.getCurrent()).toBeNull();
    });
  }

  it("rejects one group while leaving another applicable over tracked text", () => {
    const editor = new AiTestEditor(doc(p("fox end", "p")));
    const api = new AiSuggestionsAPI(editor);
    propose(api, "slow fox end");
    api.apply({ mode: "tracked" });
    propose(api, "slower fox END");
    const before = editor.getState().doc;

    api.reject({ groupId: firstGroup(api) });

    expect(editor.getState().doc).toBe(before);
    expect(api.getCurrent()).not.toBeNull();
    api.apply({ mode: "direct" });
    expect(editor.text).toBe("slow fox END");
    expect(markedText(editor, "trackedInsert")).toBe("slow ");
    expect(api.getCurrent()).toBeNull();
  });

  it("discards a re-shown stale proposal without undoing its committed changes", () => {
    const editor = new AiTestEditor(doc(p("fox", "p")));
    const api = new AiSuggestionsAPI(editor);
    const original = propose(api, "slow fox");
    api.apply({ mode: "tracked" });
    const before = editor.getState().doc;
    api.show(original);
    expect(editor.suggestionState!.staleBlockIds.has("p")).toBe(true);

    api.reject();

    expect(editor.getState().doc).toBe(before);
    expect(api.getCurrent()).toBeNull();
  });

  it("requires the requested group to belong to the requested block", () => {
    const editor = new AiTestEditor(doc(p("one", "p"), p("two", "q")));
    const api = new AiSuggestionsAPI(editor);
    const suggestion = api.compute({ authorID: "AI", blocks: [
      { nodeId: "p", proposedText: "ONE" },
      { nodeId: "q", proposedText: "TWO" },
    ] })!;
    api.show(suggestion);
    const groupId = firstGroup(api);

    api.reject({ blockId: "q", groupId });
    expect(api.getCurrent()).toBe(suggestion);
    api.reject({ blockId: "missing", groupId });
    expect(api.getCurrent()).toBe(suggestion);
    api.reject({ blockId: "p", groupId });
    expect(api.getCurrent()!.blocks.map((block) => block.nodeId)).toEqual(["q"]);
    api.apply({ mode: "direct" });
    expect(editor.text).toBe("oneTWO");
  });
});
