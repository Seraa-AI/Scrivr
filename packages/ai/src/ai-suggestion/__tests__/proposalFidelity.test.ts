/**
 * A proposal has to land on the words it was written about.
 *
 * Both failures here come from the same mistake — treating the diff's output
 * order as the order the proposal reads in, and treating a size guard meant for
 * genuinely different text as applying to text that did not change.
 */
import { describe, expect, it } from "vitest";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, markedText, p, schema } from "./helpers";

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

describe("a one-word fix in a long formatted clause, as plain text", () => {
  it("changes that word alone and keeps the clause's formatting, the new word included", () => {
    const long = "The parties acknowledge and agree that this clause survives termination. ".repeat(7).trim();
    const clause = schema.nodes["paragraph"]!.create({ nodeId: "p1" }, schema.text(long, [schema.marks["bold"]!.create()]));
    const editor = new AiTestEditor(doc(clause));
    const proposed = long.replace("survives", "outlives");
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: proposed }],
      authorID: "AI Assistant",
    })!;

    const ops = suggestion.blocks[0]!.ops;
    expect(ops.filter((op) => op.type === "delete").map((op) => op.text)).toEqual(["survives"]);
    const inserts = ops.filter((op) => op.type === "insert");
    expect(inserts.map((op) => op.text)).toEqual(["outlives"]);
    expect(inserts[0]!.marks?.map((m) => m.type)).toEqual(["bold"]);
    // Kept text restates what it reads, so nothing proposes formatting.
    expect(ops.filter((op) => op.type === "keep").every((op) => op.marks === undefined)).toBe(true);

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });
    expect(editor.getState().doc.textContent).toBe(proposed);
    expect(markedText(editor, "bold")).toBe(proposed);
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
