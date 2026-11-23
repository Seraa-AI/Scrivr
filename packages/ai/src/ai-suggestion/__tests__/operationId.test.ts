/**
 * A host names the suggestion a tracked change came from: the id it passes
 * when applying a suggestion is on every change that suggestion writes, so the
 * document itself can say which suggestion a change belongs to — through
 * review of its other changes, and in the semantic export.
 */
import "@scrivr/export-semantic/augment";
import { describe, expect, it } from "vitest";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { findChanges, trackChangesPluginKey } from "@scrivr/plugins";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, p } from "./helpers";

const propose = (editor: AiTestEditor, nodeId: string, proposedText: string) =>
  editor.showSuggestion(computeAiSuggestion(editor.getState(), { authorID: "ai:assistant", blocks: [{ nodeId, proposedText }] }));
const pending = (editor: AiTestEditor) => findChanges(editor.getState()).pending;

describe("an operation id on a suggestion", () => {
  it("is on every change the suggestion writes, and in the semantic export", () => {
    const editor = new AiTestEditor(doc(p("teh quick brwn fox jumpd over", "p1")), "human", { canAcceptReject: true });
    propose(editor, "p1", "the quick brown fox jumped over");
    expect(editor.apply({ mode: "tracked", operationId: "row-1" })).toBe(true);

    expect(pending(editor).length).toBeGreaterThan(1);
    expect(pending(editor).every((change) => change.dataTracked.operationId === "row-1")).toBe(true);
    const changes = toSemanticUnits(editor)[0]!.changes ?? [];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((change) => change.operationId === "row-1")).toBe(true);
  });

  it("keeps two suggestions by one author apart, even where their changes touch", () => {
    const editor = new AiTestEditor(doc(p("alpha beta", "p1")), "human", { canAcceptReject: true });
    propose(editor, "p1", "alpha beta gamma");
    editor.apply({ mode: "tracked", operationId: "row-1" });
    propose(editor, "p1", "alpha beta gamma delta");
    editor.apply({ mode: "tracked", operationId: "row-2" });

    const byOperation = new Map<string, string>();
    for (const change of pending(editor)) byOperation.set(change.dataTracked.operationId ?? "none", change.dataTracked.authorID);
    expect([...byOperation.keys()].sort()).toEqual(["row-1", "row-2"]);
  });

  it("stays on the changes still pending after another of the suggestion's is decided", () => {
    const editor = new AiTestEditor(doc(p("teh cat sat on teh mat", "p1")), "human", { canAcceptReject: true });
    propose(editor, "p1", "the cat sat on the mat");
    editor.apply({ mode: "tracked", operationId: "row-1" });
    const [first] = pending(editor);
    editor.commands.setChangeStatuses("accepted", [first!.id]);
    expect(trackChangesPluginKey.getState(editor.getState())?.lastReview?.status).toBe("applied");

    const rest = pending(editor);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((change) => change.dataTracked.operationId === "row-1")).toBe(true);
  });

  it("is left off when the host passes none", () => {
    const editor = new AiTestEditor(doc(p("teh cat", "p1")), "human");
    propose(editor, "p1", "the cat");
    editor.apply({ mode: "tracked" });
    expect(pending(editor).some((change) => "operationId" in change.dataTracked)).toBe(false);
  });
});

describe("an operation id on an agent's semantic edit", () => {
  it("is on the text and structural changes it writes", async () => {
    const { ServerEditor, StarterKit } = await import("@scrivr/core");
    const { TrackChanges, TrackChangesStatus } = await import("@scrivr/plugins");
    const { AiToolkit } = await import("../../ai-toolkit/AiToolkit");
    const { getAiToolkit } = await import("../../ai-toolkit/aiToolkitRegistry");
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "human", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "teh cat" }] },
        { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "gone" }] },
      ] },
    });
    const ai = getAiToolkit(editor)!;
    const result = ai.applySemanticEdits(
      [{ kind: "richText", nodeId: "a", spans: [{ text: "the cat", marks: [] }] }, { kind: "structural", op: "deleteBlock", nodeId: "b" }],
      { authorID: "ai:assistant", operationId: "row-9" },
    );
    expect(result.applied).toBe(true);
    const all = findChanges(editor.getState()).pending;
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((change) => change.dataTracked.operationId === "row-9")).toBe(true);
  });
});
