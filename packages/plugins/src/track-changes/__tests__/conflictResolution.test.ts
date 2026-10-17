import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { planReview, reviewChanges, trackChangesPluginKey } from "../index";

/**
 * Resolving a conflict keeps one author's change and discards the others: one
 * decision, even though it is two statuses. Both sides are decided together, so
 * neither counts as work the other would silently decide.
 */

const build = () =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({
        userID: "alice",
        initialStatus: TrackChangesStatus.enabled,
        canAcceptReject: true,
      }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    },
  });

const pending = (editor: ServerEditor) =>
  trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;

const as = (editor: ServerEditor, author: string) => editor.commands.setTrackChangesUserID(author);

/** Alice adds " world"; Bob deletes what she added. */
const conflict = () => {
  const editor = build();
  editor.applyTransaction(editor.getState().tr.insertText(" world", 6));
  as(editor, "bob");
  editor.applyTransaction(editor.getState().tr.delete(6, 12));
  const insertion = pending(editor).find(c => c.dataTracked.authorID === "alice")!;
  const deletion = pending(editor).find(c => c.dataTracked.authorID === "bob")!;
  return { editor, insertion: insertion.id, deletion: deletion.id };
};

describe("resolving a conflict is one decision", () => {
  it("keeps the deletion", () => {
    const { editor, insertion, deletion } = conflict();

    const outcome = reviewChanges(editor, { accepted: [deletion], rejected: [insertion] });

    expect(outcome.status).toBe("applied");
    expect(editor.getState().doc.textContent).toBe("hello");
    expect(pending(editor)).toEqual([]);
  });

  it("keeps the insertion", () => {
    const { editor, insertion, deletion } = conflict();

    const outcome = reviewChanges(editor, { accepted: [insertion], rejected: [deletion] });

    expect(outcome.status).toBe("applied");
    expect(editor.getState().doc.textContent).toBe("hello world");
    expect(pending(editor)).toEqual([]);
  });

  it("still names work outside the conflict that the kept side would take", () => {
    const editor = build();
    const paragraph = editor.schema.node("paragraph", null, editor.schema.text("new"));
    editor.applyTransaction(editor.getState().tr.insert(0, paragraph));
    const creation = pending(editor).find(c => c.type === "node-change")!.id;
    as(editor, "bob");
    editor.applyTransaction(editor.getState().tr.delete(0, paragraph.nodeSize));
    const deletion = pending(editor).find(c => c.dataTracked.authorID === "bob" && c.type === "node-change")!.id;
    as(editor, "carol");
    editor.applyTransaction(editor.getState().tr.insertText("!", 2));
    const carol = pending(editor).find(c => c.dataTracked.authorID === "carol")!.id;
    const before = editor.getState().doc;

    const outcome = reviewChanges(editor, { accepted: [deletion], rejected: [creation] });

    expect(outcome).toMatchObject({ status: "blocked", reason: "dependent-changes" });
    const dependents = outcome.status === "blocked" && outcome.reason === "dependent-changes"
      ? [...new Set(outcome.dependencies.flatMap(d => d.dependentIds))]
      : [];
    expect(dependents).toEqual([carol]);
    expect(editor.getState().doc).toBe(before);
  });

  it("refuses a change asked to be both accepted and rejected", () => {
    const { editor, insertion, deletion } = conflict();

    const plan = planReview(editor, { accepted: [insertion, deletion], rejected: [deletion] });

    expect(plan).toMatchObject({ status: "blocked", reason: "contradictory-decisions", contradictoryIds: [deletion] });
  });
});
