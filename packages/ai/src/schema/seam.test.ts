/**
 * The protocol's output is the suggestion lane's input.
 *
 * `@scrivr/ai` publishes one vocabulary for inline runs — the zod-validated one
 * — and every public entry point speaks it. A consumer that parses agent output
 * and hands the result to the suggestion lane should not have to convert
 * anything in between; if it did, it would have to write the conversion itself,
 * and this repo gives it no `as` to do that with.
 *
 * This test is that path, end to end, through the package barrel.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { computeAiSuggestion, parseSemanticEdits } from "../index";

describe("parsed agent output feeds the suggestion lane", () => {
  it("accepts a validated edit's spans with no conversion at the call site", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "the term" }] }],
      },
    });

    const { edits, rejected } = parseSemanticEdits([
      {
        kind: "richText",
        nodeId: "p1",
        spans: [
          { text: "the ", marks: [] },
          { text: "term", marks: [{ type: "bold" }] },
        ],
      },
    ]);
    expect(rejected).toHaveLength(0);

    const edit = edits[0];
    expect(edit?.kind).toBe("richText");
    if (edit?.kind !== "richText" || !edit.spans) throw new Error("expected a rich edit with spans");

    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: edit.nodeId, proposedSpans: edit.spans }],
      authorID: "AI Assistant",
    });

    expect(suggestion).not.toBeNull();
    const ops = suggestion!.blocks[0]!.ops;
    expect(ops.some((op) => op.marks?.some((mark) => mark.type === "bold"))).toBe(true);
  });
});
