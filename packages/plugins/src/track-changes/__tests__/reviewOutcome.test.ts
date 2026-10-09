import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { planReview, reviewChanges } from "../index";
import { trackChangesPluginKey } from "../index";

/**
 * Every review call reports what happened. A refusal names its own reason, so a
 * caller can explain it rather than offering one remedy for every cause — and
 * the executed outcome, not the plan that preceded it, is what says the work is
 * done.
 */

const build = (canAcceptReject = true) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({
        userID: "alice",
        initialStatus: TrackChangesStatus.enabled,
        canAcceptReject,
      }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "tail" }] }],
    },
  });

const pending = (editor: ServerEditor) =>
  trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;

const insertParagraph = (editor: ServerEditor) => {
  const node = editor.schema.node("paragraph", { nodeId: "new" }, editor.schema.text("new"));
  editor.applyTransaction(editor.getState().tr.insert(0, node));
};

describe("reviewChanges reports the executed outcome", () => {
  it("applies a decision and says so", () => {
    const editor = build();
    insertParagraph(editor);

    const outcome = reviewChanges(editor, "accepted", pending(editor).map(c => c.id));

    expect(outcome.status).toBe("applied");
    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc.textContent).toBe("newtail");
  });

  it("names dependent changes rather than deciding them", () => {
    const editor = build();
    insertParagraph(editor);
    const creation = pending(editor).find(
      c => c.type === "node-change" && c.dataTracked.operation === "insert",
    )!;
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const before = editor.getState().doc;

    const outcome = reviewChanges(editor, "rejected", [creation.id]);

    expect(outcome.status).toBe("blocked");
    expect(outcome.status === "blocked" && outcome.reason).toBe("dependent-changes");
    const dependents =
      outcome.status === "blocked" && outcome.reason === "dependent-changes"
        ? outcome.dependencies.flatMap(d => d.dependentIds)
        : [];
    expect(dependents.length).toBeGreaterThan(0);
    // Named, not decided.
    expect(editor.getState().doc).toBe(before);
  });

  it("distinguishes a change that is not pending from one with dependents", () => {
    const editor = build();
    insertParagraph(editor);

    const outcome = reviewChanges(editor, "accepted", ["no-such-change"]);

    expect(outcome.status === "blocked" && outcome.reason).toBe("missing-changes");
    expect(pending(editor).length).toBeGreaterThan(0);
  });

  it("distinguishes a reviewer who may not decide at all", () => {
    const editor = build(false);
    insertParagraph(editor);

    const outcome = reviewChanges(editor, "accepted", pending(editor).map(c => c.id));

    expect(outcome.status === "blocked" && outcome.reason).toBe("not-permitted");
  });

  it("replans against the current document", () => {
    const editor = build();
    insertParagraph(editor);
    const creation = pending(editor).find(
      c => c.type === "node-change" && c.dataTracked.operation === "insert",
    )!;
    expect(planReview(editor, "rejected", [creation.id]).status).toBe("ready");

    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));

    expect(planReview(editor, "rejected", [creation.id]).status).toBe("blocked");
  });
});
