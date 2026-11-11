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
import { AiTestEditor, doc, markedText, p, schema } from "./helpers";
import type { AiOp } from "../types";

const bold = () => schema.marks.bold!.create();

const proposal = (editor: AiTestEditor, spans: { text: string; marks: { type: string }[] }[]) =>
  computeAiSuggestion(editor.getState(), {
    blocks: [{ nodeId: "p1", proposedSpans: spans }],
    authorID: "AI Assistant",
  });

const opsOf = (editor: AiTestEditor, spans: { text: string; marks: { type: string }[] }[]): AiOp[] =>
  proposal(editor, spans)?.blocks[0]?.ops ?? [];

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
    // Anchored over "and" itself — a highlight of the right length over the
    // wrong words would read as correct.
    const { from, to } = format[0]!;
    expect(state.doc.textBetween(from, to)).toBe("and");
  });

  it("draws nothing for a run the proposal restates unchanged", () => {
    // The proposal covers this run and asks for exactly what it already reads
    // as, so compute strips its marks and the overlay has nothing to say.
    const editor = new AiTestEditor(doc(
      schema.node("paragraph", { nodeId: "p1" }, schema.text("already bold", [bold()])),
    ));
    const ops = opsOf(editor, [{ text: "already bold", marks: [{ type: "bold" }] }]);
    expect(ops).toEqual([]);

    const state = editor.getState();
    const { map } = buildAcceptedTextMap(state.doc.child(0), 0, state.schema);
    expect(buildOpRenderInstructions([{ type: "keep", text: "already bold" }], map, new CharacterMap(), 0)).toEqual([]);
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

    expect(markedText(editor, "bold")).toBe("first");
  });
});

describe("a group is addressed across the whole suggestion", () => {
  it("does not reuse one group id in two blocks", () => {
    const editor = new AiTestEditor(doc(p("alpha", "p1"), p("beta", "p2")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [
        { nodeId: "p1", proposedSpans: [{ text: "alpha", marks: [{ type: "bold" }] }] },
        { nodeId: "p2", proposedSpans: [{ text: "beta", marks: [{ type: "italic" }] }] },
      ],
      authorID: "AI Assistant",
    })!;

    const ids = suggestion.blocks.flatMap((b) => b.ops.filter((o) => o.marks).map((o) => o.groupId));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    editor.showSuggestion(suggestion);
    const firstId = suggestion.blocks[0]!.ops.find((o) => o.marks)?.groupId;
    if (firstId === undefined) throw new Error("expected a formatting group");
    editor.apply({ mode: "direct", groupId: firstId });

    // Accepting paragraph one must not style paragraph two.
    expect(markedText(editor, "bold")).toBe("alpha");
    let italic = "";
    editor.getState().doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "italic")) italic += node.text;
    });
    expect(italic).toBe("");
  });
});

describe("a settled group stays settled", () => {
  it("does not re-apply formatting the reader rejected", () => {
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
    const groups = suggestion.blocks[0]!.ops.filter((o) => o.marks).map((o) => o.groupId);
    const rejected = groups[0];
    if (rejected === undefined) throw new Error("expected a formatting group");

    editor.reject({ groupId: rejected });
    editor.apply({ mode: "direct" });

    // "one" was turned down; accepting the rest must not bring it back.
    expect(markedText(editor, "bold")).toBe("two");
  });
});

describe("formatting boundaries the document already has", () => {
  it("sees a change whose first character already matches", () => {
    // "al" is plain and "pha" is bold, so a proposal of plain throughout does
    // change the run — while its first character already reads plain.
    const editor = new AiTestEditor(doc(
      schema.node("paragraph", { nodeId: "p1" }, [
        schema.text("al"),
        schema.text("pha", [bold()]),
      ]),
    ));

    const suggestion = proposal(editor, [{ text: "alpha", marks: [] }]);
    expect(suggestion).not.toBeNull();

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });
    expect(markedText(editor, "bold")).toBe("");
  });
});
