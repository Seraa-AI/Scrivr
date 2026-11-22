/**
 * A plain-text proposal says nothing about formatting: its new words take the
 * document's, and its kept text proposes none, whatever the paragraph holds —
 * a line break, or a mark another author has proposed removing.
 */
import { describe, expect, it } from "vitest";
import type { Node as PmNode } from "@scrivr/core/pm";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, schema } from "./helpers";

const bold = () => schema.marks["bold"]!.create();
/** "ab", a line break, then bold "cd tail". */
const brokenLine = (): PmNode => doc(schema.nodes["paragraph"]!.create({ nodeId: "p1" }, [
  schema.text("ab"), schema.nodes["hardBreak"]!.create(), schema.text("cd tail", [bold()]),
]));
const formattingGroups = (suggestion: ReturnType<typeof computeAiSuggestion>) =>
  (suggestion?.blocks ?? []).flatMap((block) => block.ops).filter((op) => op.groupId?.startsWith("fmt_"));

describe("a plain proposal in a paragraph with a line break", () => {
  it("proposes nothing when it restates the paragraph", () => {
    const editor = new AiTestEditor(brokenLine());
    expect(computeAiSuggestion(editor.getState(), { blocks: [{ nodeId: "p1", proposedText: "ab\ncd tail" }], authorID: "AI" })).toBeNull();
  });

  it("proposes the word it changes and no formatting", () => {
    const editor = new AiTestEditor(brokenLine());
    const suggestion = computeAiSuggestion(editor.getState(), { blocks: [{ nodeId: "p1", proposedText: "ab\ncd end" }], authorID: "AI" });
    expect(formattingGroups(suggestion)).toEqual([]);
    expect(suggestion!.blocks[0]!.ops.find((op) => op.type === "insert")?.marks?.map((m) => m.type)).toEqual(["bold"]);
  });
});

describe("a plain proposal beside another author's pending unformat", () => {
  it("leaves that author's change alone", () => {
    const editor = new AiTestEditor(doc(schema.nodes["paragraph"]!.create({ nodeId: "p1" }, [
      schema.text("alpha "), schema.text("beta", [bold()]), schema.text(" gamma"),
    ])), "bob");
    // Bob proposes taking the bold off "beta", with the editor's own mark type.
    const state = editor.getState();
    editor.applyTransaction(state.tr.removeMark(7, 11, state.schema.marks["bold"]!));
    let unboldProposed = false;
    editor.getState().doc.nodesBetween(7, 11, (node) => {
      if (node.marks.some((m) => m.type.name === "bold" && Array.isArray(m.attrs["dataTracked"]) && m.attrs["dataTracked"].length > 0)) unboldProposed = true;
    });
    expect(unboldProposed).toBe(true);

    const suggestion = computeAiSuggestion(editor.getState(), { blocks: [{ nodeId: "p1", proposedText: "one beta gamma" }], authorID: "AI" });
    expect(formattingGroups(suggestion)).toEqual([]);
  });
});

describe("a call that names one block twice", () => {
  it("leaves that block out, says so, and keeps the rest", () => {
    const editor = new AiTestEditor(doc(
      schema.nodes["paragraph"]!.create({ nodeId: "p1" }, schema.text("alpha beta gamma")),
      schema.nodes["paragraph"]!.create({ nodeId: "p2" }, schema.text("teh end")),
    ));
    const warnings: string[] = [];
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [
        { nodeId: "p1", proposedText: "alpha one gamma" },
        { nodeId: "p2", proposedText: "the end" },
        { nodeId: "p1", proposedText: "alpha two gamma" },
      ],
      authorID: "AI",
      onWarn: (message) => warnings.push(message),
    });

    expect(suggestion!.blocks.map((block) => block.nodeId)).toEqual(["p2"]);
    expect(warnings.some((message) => message.includes("p1"))).toBe(true);
  });
});
