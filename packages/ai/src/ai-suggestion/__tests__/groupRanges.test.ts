/**
 * What a reader is offered for each kind of group.
 *
 * A formatting group replaces no words and inserts none, so a surface keyed on
 * `replacedText`/`insertedText` alone has nothing to show for it — it renders
 * an empty card over text it cannot describe.
 */
import { describe, expect, it } from "vitest";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { buildGroupRanges } from "../groupRanges";
// Through the barrel, so the published shape is exercised, not just the module.
import type { SuggestionGroupInfo } from "../index";
import { AiTestEditor, doc, p } from "./helpers";

const rangesFor = (editor: AiTestEditor, options: Parameters<typeof computeAiSuggestion>[1]) => {
  const suggestion = computeAiSuggestion(editor.getState(), options)!;
  const state = editor.getState();
  const { map } = buildAcceptedTextMap(state.doc.child(0), 0, state.schema);
  return [...buildGroupRanges(suggestion.blocks[0]!.ops, map).values()];
};

describe("a formatting group", () => {
  it("is described by the run whose appearance changes", () => {
    const editor = new AiTestEditor(doc(p("keep this clause", "p1")));
    const ranges = rangesFor(editor, {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "keep this ", marks: [] },
        { text: "clause", marks: [{ type: "bold" }] },
      ] }],
      authorID: "AI Assistant",
    });

    expect(ranges).toHaveLength(1);
    // Neither field a wording change relies on says anything here.
    expect(ranges[0]!.replacedText).toBe("");
    expect(ranges[0]!.insertedText).toBe("");
    expect(ranges[0]!.formattedText).toBe("clause");
    // And it spans the run itself, so a popover anchors over the right words.
    expect(ranges[0]!.to - ranges[0]!.from).toBe("clause".length);
  });
});

describe("a wording group", () => {
  it("is described by what it replaces and what it proposes", () => {
    const editor = new AiTestEditor(doc(p("keep this clause", "p1")));
    const ranges = rangesFor(editor, {
      blocks: [{ nodeId: "p1", proposedText: "keep this term" }],
      authorID: "AI Assistant",
    });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.replacedText).toBe("clause");
    expect(ranges[0]!.insertedText).toBe("term");
    expect(ranges[0]!.formattedText).toBeUndefined();
  });
});

describe("the published group description", () => {
  it("carries the formatting field a surface needs to describe one", () => {
    // Compile-level guard: dropping `formattedText` from the exported type
    // fails here rather than at a consumer.
    const info: Pick<SuggestionGroupInfo, "replacedText" | "insertedText" | "formattedText"> = {
      replacedText: "", insertedText: "", formattedText: "clause",
    };
    expect(info.formattedText).toBe("clause");
  });
});
