/**
 * What happens to the rest of a proposal when one part of it is settled.
 *
 * A suggestion's ops are offsets into the block's text as it was when the
 * suggestion was computed. Accepting or rejecting one group changes that text,
 * so what is left has to be re-expressed against the document that remains —
 * otherwise the next accept lands on the wrong characters, or past the end,
 * where it silently does nothing.
 */
import { describe, expect, it } from "vitest";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { subscribeToAiSuggestions } from "../subscribeToAiSuggestions";
import { AiTestEditor, doc, markedText, p, schema } from "./helpers";
import type { AiSuggestion } from "../types";

const groupsOf = (suggestion: AiSuggestion, pick: "text" | "format") =>
  suggestion.blocks
    .flatMap((b) => b.ops)
    .filter((op) => (pick === "format" ? op.type === "keep" && op.marks : op.type !== "keep"))
    .map((op) => op.groupId!)
    .filter((id, i, all) => all.indexOf(id) === i);

const live = (editor: AiTestEditor) => editor.suggestionState?.suggestion ?? null;

describe("settling one group", () => {
  it("leaves the rest applying to the right words", () => {
    const editor = new AiTestEditor(doc(p("alpha omega", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "x", marks: [] },
        { text: " ", marks: [] },
        { text: "omega", marks: [{ type: "bold" }] },
      ] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct", groupId: groupsOf(suggestion, "text")[0]! });
    expect(editor.getState().doc.textContent).toBe("x omega");

    // The remaining proposal was re-expressed against "x omega", so its offsets
    // point at the word it is about rather than past the end of the old text.
    const rest = live(editor);
    expect(rest).not.toBeNull();
    editor.apply({ mode: "direct", groupId: groupsOf(rest!, "format")[0]! });
    expect(markedText(editor, "bold")).toBe("omega");
  });

  it("keeps a later wording change reachable", () => {
    const editor = new AiTestEditor(doc(p("one two three", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: "ONE two THREE" }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    const [first, second] = groupsOf(suggestion, "text");
    editor.apply({ mode: "direct", groupId: first! });
    expect(editor.getState().doc.textContent).toBe("ONE two three");

    const rest = live(editor)!;
    editor.apply({ mode: "direct", groupId: groupsOf(rest, "text")[0]! });
    expect(editor.getState().doc.textContent).toBe("ONE two THREE");
    expect(second).toBeDefined();
  });

  it("does not re-offer what was settled", () => {
    const editor = new AiTestEditor(doc(p("alpha omega", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: "x omega" }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct", groupId: groupsOf(suggestion, "text")[0]! });

    // Nothing is left to propose, so there is no suggestion left to show.
    expect(live(editor)).toBeNull();
  });
});

describe("formatting the reader already had", () => {
  it("survives a rebase, including where it changes inside a word", () => {
    // "al" is plain and "pha" is bold — one word, two formattings, which is
    // where a run that took its first character's marks would go wrong.
    const editor = new AiTestEditor(doc(
      schema.node("paragraph", { nodeId: "p1" }, [
        schema.text("al"),
        schema.text("pha", [schema.marks.bold!.create()]),
        schema.text(" beta"),
      ]),
    ));

    // The proposal says nothing about formatting and touches the other word.
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: "alpha BETA" }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct", groupId: groupsOf(suggestion, "text")[0]! });

    // Rebasing must not invent a proposal to strip what the reader wrote.
    const rest = live(editor);
    expect(rest?.blocks[0]?.ops.filter((op) => op.type === "keep" && op.marks) ?? []).toEqual([]);
    expect(markedText(editor, "bold")).toBe("pha");
  });
});

describe("a rejected proposal", () => {
  it("is not reapplied by a later accept-all", () => {
    const editor = new AiTestEditor(doc(p("one two", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "one", marks: [{ type: "bold" }] },
        { text: " ", marks: [] },
        { text: "two", marks: [{ type: "bold" }] },
      ] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.reject({ groupId: groupsOf(suggestion, "format")[0]! });
    editor.apply({ mode: "direct" });

    expect(markedText(editor, "bold")).toBe("two");
  });

  it("leaves no card behind when it was the only one", () => {
    const editor = new AiTestEditor(doc(p("alpha", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [{ text: "alpha", marks: [{ type: "bold" }] }] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    let cards: unknown[] = [];
    subscribeToAiSuggestions(editor, (next) => { cards = next; });
    editor.reject({ groupId: groupsOf(suggestion, "format")[0]! });

    // A finished proposal is not a proposal — and an empty one used to be
    // reported as a deletion of the whole paragraph.
    expect(cards).toEqual([]);
  });
});

describe("an accept that writes nothing", () => {
  it("does not rebase as though it had", () => {
    // Tracked mode on an editor with no TrackChanges extension: there is no
    // tracked mark to write with, so the accept cannot land. Rebasing anyway
    // walks the rest of the proposal past characters that are still there, and
    // reads each run's formatting from the wrong ones.
    const editor = new AiTestEditor(
      doc(schema.node("paragraph", { nodeId: "p1" }, [
        schema.text("alpha "),
        schema.text("omega", [schema.marks.bold!.create()]),
      ])),
      "u1",
      { trackChanges: false },
    );
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: "x omega" }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "tracked", groupId: groupsOf(suggestion, "text")[0]! });

    expect(editor.getState().doc.textContent).toBe("alpha omega");
    // No formatting was ever proposed, so none may appear — the reader's bold
    // must not become something they are asked to strip.
    const rest = live(editor);
    expect(rest?.blocks[0]?.ops.filter((op) => op.type === "keep" && op.marks) ?? []).toEqual([]);
    expect(markedText(editor, "bold")).toBe("omega");
  });
});
