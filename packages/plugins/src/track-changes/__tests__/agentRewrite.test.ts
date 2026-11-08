/**
 * An agent's rewrite reads as a person's edit would: each changed phrase is
 * one deletion of the old words and one insertion of the new ones, as when
 * someone selects text and types over it. Never a change per word, and never
 * one inside a word.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
// Through the package barrel, as a host imports them.
import { applyDiffAsSuggestion, applyRichDiffAsSuggestion, findChanges, TrackChanges, TrackChangesStatus } from "../index";

const editorWith = (text: string) =>
  new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text }] }] },
  });

/** Each pending text change as `-old` or `+new`, in document order. */
const proposed = (editor: ServerEditor) =>
  findChanges(editor.getState()).pending
    .filter((change) => change.type === "text-change")
    .map((change) => `${change.dataTracked.operation === "delete" ? "-" : "+"}${change.text}`);

const rewrites: Array<{ name: string; apply: (editor: ServerEditor, text: string) => void }> = [
  {
    name: "a rich rewrite",
    apply: (editor, text) =>
      applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
        edits: [{ nodeId: "p", spans: [{ text, marks: [] }] }],
        authorID: "agent",
      }),
  },
  {
    name: "a plain rewrite",
    apply: (editor, text) =>
      applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
        nodeId: "p", proposedText: text, authorID: "agent",
      }),
  },
];

describe.each(rewrites)("$name", ({ apply }) => {
  it("replaces a misspelt word whole, not the letters inside it", () => {
    const editor = editorWith("The policy applys to all staff.");
    apply(editor, "The policy applies to all staff.");

    expect(proposed(editor)).toEqual(["-applys", "+applies"]);
  });

  it("replaces changes close together as one phrase", () => {
    const editor = editorWith("All staff, contractors is covered.");
    apply(editor, "All staff; contractors are covered.");

    expect(proposed(editor)).toEqual(["-, contractors is", "+; contractors are"]);
  });

  it("keeps changes far apart as separate replacements", () => {
    const editor = editorWith("Core hours is ten to three in the employees local timezone.");
    apply(editor, "Core hours are ten to three in the employee's local timezone.");

    expect(proposed(editor)).toEqual(["-is", "+are", "-employees", "+employee's"]);
  });

  it("is reviewed back to the original, or on to the rewrite", () => {
    const decisions: Array<"accepted" | "rejected"> = ["accepted", "rejected"];
    for (const decision of decisions) {
      const editor = editorWith("All staff, contractors is covered.");
      apply(editor, "All staff; contractors are covered.");
      editor.commands.setChangeStatuses(decision, findChanges(editor.getState()).pending.map((change) => change.id));
      expect(editor.getState().doc.textContent).toBe(
        decision === "accepted" ? "All staff; contractors are covered." : "All staff, contractors is covered.",
      );
    }
  });
});
