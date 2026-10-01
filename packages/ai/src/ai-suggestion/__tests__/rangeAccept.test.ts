/**
 * Accepting a suggestion scoped to a span, not a whole block.
 *
 * `accept(blockId)` applies every op the block carries, so a finding that only
 * meant to change one sentence rewrites the clause around it too. The span has
 * to be resolved against the live document at accept time: a span that has
 * drifted since the suggestion was written is not the span the model meant,
 * and applying it anyway is the failure this exists to prevent.
 */
import { describe, it, expect } from "vitest";
import { AiTestEditor, doc, p } from "./helpers";
import type { AiSuggestion } from "../types";

const ACCEPTED = "One stays. Two changes. Three stays.";

/** Two independent groups in one block, each scoped to its own sentence. */
function twoSentences(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: ACCEPTED,
        ops: [
          { type: "keep", text: "One " },
          { type: "delete", text: "stays", groupId: "g1" },
          { type: "insert", text: "held", groupId: "g1" },
          { type: "keep", text: ". Two " },
          { type: "delete", text: "changes", groupId: "g2" },
          { type: "insert", text: "moved", groupId: "g2" },
          { type: "keep", text: ". Three stays." },
        ],
      },
    ],
  };
}

const editorWith = (text: string) => new AiTestEditor(doc(p(text, "b1")));

describe("accepting a range within a block", () => {
  it("applies only what the range covers", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    // "Two changes" — the second sentence only.
    editor.apply({ blockId: "b1", range: { from: 11, to: 24 }, mode: "direct" });

    expect(editor.text).toBe("One stays. Two moved. Three stays.");
  });

  it("leaves the rest of the block pending, not settled", () => {
    // Asserted by what the remaining proposal still says, not by group id:
    // settling rebases the block, which re-mints the ids of what is left.
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 24 }, mode: "direct" });

    const pending = editor.suggestionState?.suggestion?.blocks.flatMap((b) => b.ops) ?? [];
    expect(pending.filter((op) => op.type === "insert").map((op) => op.text)).toEqual(["held"]);
    expect(pending.filter((op) => op.type === "delete").map((op) => op.text)).toEqual(["stays"]);
  });

  it("applies a group only when the range contains the whole of it", () => {
    // Half a replacement is not a smaller replacement — it is a different one.
    // A group the range only clips is left for the reader to accept whole.
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 20 }, mode: "direct" });

    expect(editor.text).toBe(ACCEPTED);
  });

  it("can take the whole block, and then matches an unscoped accept", () => {
    const scoped = editorWith(ACCEPTED);
    scoped.showSuggestion(twoSentences("b1"));
    scoped.apply({ blockId: "b1", range: { from: 0, to: ACCEPTED.length }, mode: "direct" });

    const whole = editorWith(ACCEPTED);
    whole.showSuggestion(twoSentences("b1"));
    whole.apply({ blockId: "b1", mode: "direct" });

    expect(scoped.text).toBe(whole.text);
  });

  it("refuses a range whose text has drifted since the suggestion was written", () => {
    // The offsets describe a snapshot. Once the reader has edited the block,
    // they address different words, and applying them lands the change on
    // text the model never saw.
    const editor = editorWith("Something else entirely here now.");
    editor.showSuggestion(twoSentences("b1"));
    const before = editor.text;

    const applied = editor.apply({ blockId: "b1", range: { from: 11, to: 24 }, mode: "direct" });

    expect(applied).toBe(false);
    expect(editor.text).toBe(before);
  });

  it("says whether it wrote anything", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    // A range covering only unchanged text has no group to apply.
    expect(editor.apply({ blockId: "b1", range: { from: 24, to: 36 }, mode: "direct" })).toBe(false);
    expect(editor.apply({ blockId: "b1", range: { from: 11, to: 24 }, mode: "direct" })).toBe(true);
  });

  it("needs a block to scope to", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    expect(() => editor.apply({ range: { from: 0, to: 5 }, mode: "direct" })).toThrow(
      /blockId/,
    );
  });

  it("records the accepted span as tracked, like an unscoped accept", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 24 }, mode: "tracked" });

    expect(editor.text).toContain("moved");
  });
});

describe("acceptRange through the subscription", () => {
  it("is reachable by a host that only holds the card actions", async () => {
    const { subscribeToAiSuggestions } = await import("../subscribeToAiSuggestions");
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    let applied: boolean | null = null;
    const stop = subscribeToAiSuggestions(editor, (_cards, actions) => {
      if (applied === null) {
        applied = actions.acceptRange("b1", { from: 11, to: 24 }, "direct");
      }
    });

    expect(applied).toBe(true);
    expect(editor.text).toBe("One stays. Two moved. Three stays.");
    stop();
  });
});
