/**
 * Which blocks head a section belongs to their extensions. This one is written
 * only against the public surface: a chapter title that declares its outline
 * level on its spec, read by the semantic lane as the PDF bookmarks read it.
 */
import { describe, expect, it } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../toSemanticUnits";
import { toDocumentOutline } from "../outline";

const Chapter = Extension.create({
  name: "chapter",
  addNodes() {
    return { chapter: { group: "block", content: "inline*", outlineLevel: () => 1, toDOM: () => ["h1", 0] } };
  },
  addExports() {
    return { semantic: { nodes: { chapter: () => ({ type: "heading" }) } } };
  },
});

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const titled = (type: string, text: string, attrs: Record<string, unknown> = {}): Json => ({ type, attrs, content: [{ type: "text", text }] });

const editorOf = (content: Json[]) => new ServerEditor({ extensions: [StarterKit, Chapter], content: { type: "doc", content } });

describe("an outline block from outside core, in the semantic lane", () => {
  const content = [
    titled("chapter", "Chapter One"),
    titled("heading", "Opening", { level: 2 }),
    titled("paragraph", "Body"),
  ];

  it("heads the breadcrumb of what follows it, at the level it declares", () => {
    const units = toSemanticUnits(editorOf(content), { groupBlocks: false });
    expect(units.map((unit) => [unit.text, unit.headingLevel, unit.breadcrumb])).toEqual([
      ["Chapter One", 1, []],
      ["Opening", 2, ["Chapter One"]],
      ["Body", undefined, ["Chapter One", "Opening"]],
    ]);
  });

  it("opens a section in the document outline", () => {
    const outline = toDocumentOutline(toSemanticUnits(editorOf(content), { groupBlocks: false }));
    expect(outline.map((section) => section.path)).toEqual([["Chapter One"], ["Chapter One", "Opening"]]);
  });

  it("takes a short lede into its unit, as a heading does", () => {
    const units = toSemanticUnits(editorOf([titled("chapter", "Chapter One"), titled("paragraph", "A short lede.")]));
    expect(units.map((unit) => unit.nodeIds.length)).toEqual([2]);
  });
});
