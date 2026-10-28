import { describe, expect, it } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { Plugin } from "@scrivr/core/pm";
import { TrackChanges } from "../TrackChanges";
import { getAction, TrackChangesAction } from "../actions";
import { TrackChangesStatus } from "../types";
import { planReview, reviewChanges } from "../index";
import { trackChangesPluginKey } from "../index";

/**
 * Every review call reports what happened. A refusal names its own reason, so a
 * caller can explain it rather than offering one remedy for every cause — and
 * the executed outcome, not the plan that preceded it, is what says the work is
 * done.
 */

/** A host plugin that, once armed, vetoes review decisions before they reach the engine. */
const vetoReviews = () => {
  const veto = { armed: false };
  const extension = Extension.create({
    name: "vetoReviews",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: tr => !(veto.armed && getAction(tr, TrackChangesAction.setChangeStatuses)),
        }),
      ];
    },
  });
  return { veto, extension };
};

const build = (canAcceptReject = true, ...host: Extension[]) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      ...host,
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

    const outcome = reviewChanges(editor, { accepted: pending(editor).map(c => c.id), rejected: [] });

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

    const outcome = reviewChanges(editor, { accepted: [], rejected: [creation.id] });

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

    const outcome = reviewChanges(editor, { accepted: ["no-such-change"], rejected: [] });

    expect(outcome.status === "blocked" && outcome.reason).toBe("missing-changes");
    expect(pending(editor).length).toBeGreaterThan(0);
  });

  it("distinguishes a reviewer who may not decide at all", () => {
    const editor = build(false);
    insertParagraph(editor);

    const outcome = reviewChanges(editor, { accepted: pending(editor).map(c => c.id), rejected: [] });

    expect(outcome.status === "blocked" && outcome.reason).toBe("not-permitted");
  });

  it("replans against the current document", () => {
    const editor = build();
    insertParagraph(editor);
    const creation = pending(editor).find(
      c => c.type === "node-change" && c.dataTracked.operation === "insert",
    )!;
    expect(planReview(editor, { accepted: [], rejected: [creation.id] }).status).toBe("ready");

    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));

    expect(planReview(editor, { accepted: [], rejected: [creation.id] }).status).toBe("blocked");
  });

  it("refuses in a read-only editor, as every other way of deciding does", () => {
    const editor = build();
    insertParagraph(editor);
    const ids = pending(editor).map(c => c.id);
    editor.setReadOnly(true);
    const before = editor.getState().doc;

    expect(planReview(editor, { accepted: [], rejected: ids })).toMatchObject({ status: "blocked", reason: "read-only" });
    const outcome = reviewChanges(editor, { accepted: [], rejected: ids });

    expect(outcome).toMatchObject({ status: "blocked", reason: "read-only" });
    expect(editor.getState().doc).toBe(before);
  });

  it("never reports an earlier decision as this one's outcome", () => {
    const { veto, extension } = vetoReviews();
    const editor = build(true, extension);
    insertParagraph(editor);
    expect(reviewChanges(editor, { accepted: pending(editor).map(c => c.id), rejected: [] }).status).toBe("applied");
    insertParagraph(editor);
    const ids = pending(editor).map(c => c.id);
    veto.armed = true;

    const outcome = reviewChanges(editor, { accepted: ids, rejected: [] });

    expect(outcome).toMatchObject({ status: "blocked", reason: "invalid-result", accepted: expect.arrayContaining(ids) });
    expect(pending(editor).length).toBe(ids.length);
  });
});
