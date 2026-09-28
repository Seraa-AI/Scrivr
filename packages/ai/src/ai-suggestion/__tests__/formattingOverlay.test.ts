/**
 * A formatting proposal has to be visible, addressable and acceptable.
 *
 * Its words do not change, so it produces no delete strike and no insert caret.
 * Without a representation of its own it computes, applies, and shows the reader
 * nothing — a card offering a change they cannot see and cannot point at.
 */
import { describe, expect, it } from "vitest";
import { CharacterMap } from "@scrivr/core";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { buildOpRenderInstructions } from "../renderAiSuggestionOps";
import { AiTestEditor, doc, p, schema } from "./helpers";
import type { AiOp } from "../types";

const bold = () => schema.marks.bold!.create();

const proposal = (editor: AiTestEditor, spans: { text: string; marks: { type: string }[] }[]) =>
  computeAiSuggestion(editor.getState(), {
    blocks: [{ nodeId: "p1", proposedSpans: spans }],
    authorID: "AI Assistant",
  });

const opsOf = (editor: AiTestEditor, spans: { text: string; marks: { type: string }[] }[]): AiOp[] =>
  proposal(editor, spans)?.blocks[0]?.ops ?? [];

const boldedText = (editor: AiTestEditor) => {
  let out = "";
  editor.getState().doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "bold")) out += node.text;
  });
  return out;
};

describe("a keep's marks mean the formatting there changes", () => {
  it("carries marks only on the run whose formatting differs", () => {
    const editor = new AiTestEditor(doc(p("plain and more", "p1")));
    const ops = opsOf(editor, [
      { text: "plain ", marks: [] },
      { text: "and", marks: [{ type: "bold" }] },
      { text: " more", marks: [] },
    ]);

    expect(ops.every((op) => op.type === "keep")).toBe(true);
    const marked = ops.filter((op) => op.marks);
    expect(marked.map((op) => op.text)).toEqual(["and"]);
  });

  it("says nothing when the proposal restates the formatting already there", () => {
    const editor = new AiTestEditor(doc(
      schema.node("paragraph", { nodeId: "p1" }, schema.text("already bold", [bold()])),
    ));
    expect(proposal(editor, [{ text: "already bold", marks: [{ type: "bold" }] }])).toBeNull();
  });
});

describe("the overlay", () => {
  it("draws a formatting proposal that changes no words", () => {
    const editor = new AiTestEditor(doc(p("plain and more", "p1")));
    const ops = opsOf(editor, [
      { text: "plain ", marks: [] },
      { text: "and", marks: [{ type: "bold" }] },
      { text: " more", marks: [] },
    ]);

    const state = editor.getState();
    const { map } = buildAcceptedTextMap(state.doc.child(0), 0, state.schema);
    const instructions = buildOpRenderInstructions(ops, map, new CharacterMap(), 0);

    const format = instructions.filter((i) => i.type === "format");
    expect(format).toHaveLength(1);
    // Anchored over "and", the run whose appearance is in question.
    expect(format[0]!.to - format[0]!.from).toBe("and".length);
  });

  it("draws nothing for a keep the proposal leaves alone", () => {
    const editor = new AiTestEditor(doc(p("untouched", "p1")));
    const state = editor.getState();
    const { map } = buildAcceptedTextMap(state.doc.child(0), 0, state.schema);
    const ops: AiOp[] = [{ type: "keep", text: "untouched" }];

    expect(buildOpRenderInstructions(ops, map, new CharacterMap(), 0)).toEqual([]);
  });
});

describe("accepting one formatting run", () => {
  it("applies that run and leaves the others as they were", () => {
    const editor = new AiTestEditor(doc(p("first second", "p1")));
    const suggestion = proposal(editor, [
      { text: "first", marks: [{ type: "bold" }] },
      { text: " ", marks: [] },
      { text: "second", marks: [{ type: "bold" }] },
    ])!;

    const groups = suggestion.blocks[0]!.ops.filter((op) => op.marks).map((op) => op.groupId);
    expect(groups).toHaveLength(2);
    expect(new Set(groups).size).toBe(2);

    editor.showSuggestion(suggestion);
    const first = groups[0];
    if (first === undefined) throw new Error("expected a formatting group");
    editor.apply({ mode: "direct", groupId: first });

    expect(boldedText(editor)).toBe("first");
  });
});
