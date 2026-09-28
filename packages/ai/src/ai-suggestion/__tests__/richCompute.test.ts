/**
 * Formatting-aware suggestions.
 *
 * A suggestion used to be plain text on both sides, so an agent could propose
 * new wording but never propose how it reads — "bold this defined term" had no
 * representation, and an accepted insertion always landed unformatted.
 */
import { describe, expect, it } from "vitest";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, p, schema } from "./helpers";

const build = (text: string) => new AiTestEditor(doc(p(text, "p1")));

const opsOf = (editor: AiTestEditor, spans: { text: string; marks: { type: string }[] }[]) =>
  computeAiSuggestion(editor.getState(), {
    blocks: [{ nodeId: "p1", proposedSpans: spans }],
    authorID: "AI Assistant",
  })?.blocks[0]?.ops ?? [];

describe("computeAiSuggestion with spans", () => {
  it("carries the marks of an inserted run", () => {
    const editor = build("The term means this.");
    const ops = opsOf(editor, [
      { text: "The ", marks: [] },
      { text: "defined term", marks: [{ type: "bold" }] },
      { text: " means this.", marks: [] },
    ]);

    const inserts = ops.filter((o) => o.type === "insert");
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.some((o) => o.marks?.some((m) => m.type === "bold"))).toBe(true);
  });

  it("splits one inserted run where its formatting changes", () => {
    const editor = build("Start.");
    const ops = opsOf(editor, [
      { text: "Start. ", marks: [] },
      { text: "Bold", marks: [{ type: "bold" }] },
      { text: "plain", marks: [] },
    ]);

    const inserts = ops.filter((o) => o.type === "insert");
    // "Bold" and "plain" cannot share one op — they do not read the same.
    expect(inserts.find((o) => o.text.includes("Bold"))?.marks).toEqual([{ type: "bold" }]);
    expect(inserts.find((o) => o.text.includes("plain"))?.marks ?? []).toEqual([]);
  });

  it("treats proposed plain text as one unformatted run", () => {
    const editor = build("One.");
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedText: "One. Two." }],
      authorID: "AI Assistant",
    });
    const inserts = suggestion?.blocks[0]?.ops.filter((o) => o.type === "insert") ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.every((o) => (o.marks ?? []).length === 0)).toBe(true);
  });

  it("sees a formatting-only change that plain text cannot express", () => {
    const editor = build("Confidential Information");
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [{ text: "Confidential Information", marks: [{ type: "bold" }] }] }],
      authorID: "AI Assistant",
    });
    expect(suggestion).not.toBeNull();
    // The words are unchanged, so the proposal lives entirely on keeps.
    expect(suggestion!.blocks[0]!.ops.every((o) => o.type === "keep")).toBe(true);
  });
});

const boldedText = (editor: AiTestEditor) => {
  let bolded = "";
  editor.getState().doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "bold")) bolded += node.text;
  });
  return bolded;
};

describe("applying a formatted suggestion", () => {
  it("applies a formatting-only proposal, whose ops are all keeps", () => {
    const editor = build("Confidential Information");
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [{ text: "Confidential Information", marks: [{ type: "bold" }] }] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });

    expect(boldedText(editor)).toBe("Confidential Information");
  });

  it("removes formatting the proposal drops", () => {
    const editor = new AiTestEditor(doc(
      schema.node("paragraph", { nodeId: "p1" }, schema.text("Plain now", [schema.marks.bold!.create()])),
    ));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [{ text: "Plain now", marks: [] }] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });

    expect(boldedText(editor)).toBe("");
  });

  it("writes the inserted run with its marks", () => {
    const editor = build("The term means this.");
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "p1", proposedSpans: [
        { text: "The ", marks: [] },
        { text: "defined term", marks: [{ type: "bold" }] },
        { text: " means this.", marks: [] },
      ] }],
      authorID: "AI Assistant",
    })!;

    editor.showSuggestion(suggestion);
    editor.apply({ mode: "direct" });

    expect(boldedText(editor)).toContain("defined");
  });
});
