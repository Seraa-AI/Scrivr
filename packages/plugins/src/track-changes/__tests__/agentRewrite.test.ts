/**
 * An agent's rewrite reads as a person's edit would: each changed phrase is
 * one deletion of the old words and one insertion of the new ones, as when
 * someone selects text and types over it. Never a change per word, and never
 * one inside a word.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
// Through the package barrel, as a host imports them.
import { applyDiffAsSuggestion, applyMultiBlockDiff, applyRichDiffAsSuggestion, findChanges, TrackChanges, TrackChangesStatus } from "../index";

const editorOf = (inline: unknown[], userID = "u1") =>
  new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: inline }] },
  });
const editorWith = (text: string) => editorOf([{ type: "text", text }]);
const image = { type: "image", attrs: { src: "https://example.com/a.png", width: 20, height: 20 } };

/** The paragraph's text, with each break or image as "□", so its place shows. */
const laidOut = (editor: ServerEditor) => {
  const paragraph = editor.getState().doc.child(0);
  return paragraph.textBetween(0, paragraph.content.size, "", "□");
};
const acceptAll = (editor: ServerEditor) =>
  editor.commands.setChangeStatuses("accepted", findChanges(editor.getState()).pending.map((change) => change.id));

/** Each pending text change as `-old` or `+new`, in document order. */
const proposed = (editor: ServerEditor) =>
  findChanges(editor.getState()).pending
    .filter((change) => change.type === "text-change")
    .map((change) => `${change.dataTracked.operation === "delete" ? "-" : "+"}${change.text}`);

const rewrites: Array<{ name: string; lineBreak: string; apply: (editor: ServerEditor, text: string) => void }> = [
  {
    name: "a rich rewrite",
    // The rich lane reads a line break as "\n"; the plain lane has no character for it.
    lineBreak: "\n",
    apply: (editor, text) =>
      applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
        edits: [{ nodeId: "p", spans: [{ text, marks: [] }] }],
        authorID: "agent",
      }),
  },
  {
    name: "a plain rewrite",
    lineBreak: "",
    apply: (editor, text) =>
      applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
        nodeId: "p", proposedText: text, authorID: "agent",
      }),
  },
];

describe.each(rewrites)("$name", ({ apply, lineBreak }) => {
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

  it("decides a replacement whole, whichever half is reviewed", () => {
    const decisions: Array<"accepted" | "rejected"> = ["accepted", "rejected"];
    for (const decision of decisions) {
      for (const half of ["delete", "insert"]) {
        const editor = editorWith("The policy applys to all staff.");
        apply(editor, "The policy applies to all staff.");
        const reviewed = findChanges(editor.getState()).pending.filter((change) => change.dataTracked.operation === half);
        editor.commands.setChangeStatuses(decision, reviewed.map((change) => change.id));

        expect(findChanges(editor.getState()).pending).toEqual([]);
        expect(editor.getState().doc.textContent).toBe(
          decision === "accepted" ? "The policy applies to all staff." : "The policy applys to all staff.",
        );
      }
    }
  });

  it("keeps a line break where it was, not inside a replacement", () => {
    const editor = editorOf([{ type: "text", text: "teh cat" }, { type: "hardBreak" }, { type: "text", text: "sat smal" }]);
    apply(editor, `the cat${lineBreak}sat small`);
    acceptAll(editor);

    expect(laidOut(editor)).toBe("the cat□sat small");
  });

  it("keeps an inline image where it was, not inside a replacement", () => {
    const editor = editorOf([{ type: "text", text: "teh " }, image, { type: "text", text: " smal" }]);
    apply(editor, "the  small");
    acceptAll(editor);

    expect(laidOut(editor)).toBe("the □ small");
  });

  it("leaves another author's pending suggestion as theirs", () => {
    const editor = editorOf([{ type: "text", text: "teh cat smal" }], "person");
    editor.applyTransaction(editor.getState().tr.insertText("big ", 5));
    apply(editor, "the big cat small");

    expect(proposed(editor)).toEqual(["-teh", "+the", "+big ", "-smal", "+small"]);
  });

  it("adds words without striking the words between them", () => {
    const editor = editorWith("the cat sat");
    apply(editor, "the big cat sat down");

    expect(proposed(editor).every((change) => change.startsWith("+"))).toBe(true);
  });
});

describe("a replacement's two halves", () => {
  const twoParagraphs = () => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: ["teh one", "teh two"].map((text, i) => ({
      type: "paragraph", attrs: { nodeId: `p${i}` }, content: [{ type: "text", text }],
    })) },
  });
  /** Pending text changes grouped by their groupId, as cards are. */
  const groups = (editor: ServerEditor) => {
    const byGroup = new Map<string, string[]>();
    for (const change of findChanges(editor.getState()).pending) {
      if (change.type !== "text-change") continue;
      const id = change.dataTracked.groupId ?? "";
      byGroup.set(id, [...(byGroup.get(id) ?? []), change.text]);
    }
    return [...byGroup.values()];
  };

  it("share a group of their own, per paragraph, through the plain path", () => {
    const editor = twoParagraphs();
    applyMultiBlockDiff(editor.getState(), (tr) => editor.applyTransaction(tr), {
      blocks: [{ nodeId: "p0", proposedText: "the one" }, { nodeId: "p1", proposedText: "the two" }],
      authorID: "agent",
    });
    expect(groups(editor)).toEqual([["teh", "the"], ["teh", "the"]]);
  });

  it("share a group of their own, per paragraph, through the rich path", () => {
    const editor = twoParagraphs();
    applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      edits: [{ nodeId: "p0", spans: [{ text: "the one", marks: [] }] }, { nodeId: "p1", spans: [{ text: "the two", marks: [] }] }],
      authorID: "agent",
    });
    expect(groups(editor)).toEqual([["teh", "the"], ["teh", "the"]]);
  });
});
