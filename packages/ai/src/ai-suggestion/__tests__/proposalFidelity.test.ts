/**
 * A proposal has to land on the words it was written about.
 *
 * Both failures here come from the same mistake — treating the diff's output
 * order as the order the proposal reads in, and treating a size guard meant for
 * genuinely different text as applying to text that did not change.
 */
import { describe, expect, it } from "vitest";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, markedText, p } from "./helpers";

describe("a rewrite that also changes formatting", () => {
  it("marks the word the proposal marked, not whichever op came out first", () => {
    // This rewrite produces a replacement group holding both a sandwiched keep
    // and a boundary keep, which is what puts the diff's output out of the
    // order the proposal reads in.
    const editor = new AiTestEditor(doc(p("alpha beta gamma delta", "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "beta", marks: [{ type: "bold" }] },
        { text: " delta epsilon", marks: [] },
      ] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });

    expect(editor.getState().doc.textContent).toBe("beta delta epsilon");
    expect(markedText(editor, "bold")).toBe("beta");
  });
});

describe("a paragraph long enough to trip the diff's size guard", () => {
  it("still proposes formatting rather than rewriting every character", () => {
    // Over the guard's threshold on both sides — ordinary for a contract clause.
    const long = "The parties acknowledge and agree that this clause survives termination. ".repeat(7);
    expect(long.length).toBeGreaterThan(450);

    const editor = new AiTestEditor(doc(p(long, "p1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [{ text: long, marks: [{ type: "bold" }] }] }],
      authorID: "AI Assistant",
    })!;

    const ops = suggestion.blocks[0]!.ops;
    // Nothing is being removed or added — only how the text reads.
    expect(ops.every((op) => op.type === "keep")).toBe(true);
    expect(ops.some((op) => op.marks?.some((m) => m.type === "bold"))).toBe(true);

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });
    expect(editor.getState().doc.textContent).toBe(long);
    expect(markedText(editor, "bold")).toBe(long);
  });
});

describe("a group belongs to the block it came from", () => {
  it("does not settle an unrelated group in another block", () => {
    // Both paragraphs have a replacement at the same token index, which is what
    // used to give them the same generated group id.
    const editor = new AiTestEditor(doc(p("one two", "p1"), p("one three", "p2")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [
        { nodeId: "p1", proposedText: "ONE two" },
        { nodeId: "p2", proposedText: "ONE three" },
      ],
      authorID: "AI Assistant",
    })!;

    const idsOf = (i: number) =>
      suggestion.blocks[i]!.ops.filter((o) => o.groupId).map((o) => o.groupId!);
    expect(idsOf(0).some((id) => idsOf(1).includes(id))).toBe(false);

    editor.showSuggestion(suggestion);
    const first = idsOf(0)[0];
    if (first === undefined) throw new Error("expected a group");
    editor.apply({ mode: "direct", groupId: first });

    // p2's proposal is untouched and still live.
    expect(editor.getState().doc.child(1).textContent).toBe("one three");
    const after = editor.suggestionState?.suggestion?.blocks.find((b) => b.nodeId === "p2");
    expect(after?.ops.some((o) => o.type !== "keep")).toBe(true);
  });
});
