/**
 * The semantic outline visits the headings the PDF bookmarks do: one nested in
 * a list, a sourced block or a table cell heads what follows it, an empty one
 * (in the proposed view) heads nothing, and a section is titled by its heading
 * alone, whatever the unit grouped with it.
 */
import { describe, expect, it } from "vitest";
import { Extension, ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../toSemanticUnits";
import { toDocumentOutline } from "../outline";

/** A mark the proposed view leaves out, as a tracked deletion is: its runs are dropped and reported removed. */
const Struck = Extension.create({
  name: "struck",
  addMarks() {
    return { struck: { toDOM: () => ["s", 0] } };
  },
  addExports() {
    const lanes = { semantic: {
      marks: { struck: () => null },
      isRemoved: (node: { marks: readonly { type: { name: string } }[] }) => node.marks.some((mark) => mark.type.name === "struck"),
    } };
    return lanes;
  },
});

type Json = { type: string; attrs?: Record<string, unknown>; marks?: Json[]; content?: Json[]; text?: string };
const text = (value: string, marks: Json[] = []): Json => ({ type: "text", text: value, ...(marks.length ? { marks } : {}) });
const h = (level: number, ...content: Json[]): Json => ({ type: "heading", attrs: { level }, content });
const p = (value: string): Json => ({ type: "paragraph", content: [text(value)] });

const unitsOf = (content: Json[], groupBlocks = false) =>
  toSemanticUnits(new ServerEditor({ extensions: [StarterKit, Struck], content: { type: "doc", content } }), { groupBlocks });

describe("the semantic outline, beside the PDF bookmarks", () => {
  it("heads what follows with a heading nested in a list", () => {
    const units = unitsOf([
      h(1, text("Top")),
      { type: "bulletList", content: [{ type: "listItem", content: [p("item"), h(2, text("In list"))] }] },
      p("after"),
    ]);
    expect(units.map((unit) => unit.breadcrumb)).toEqual([[], ["Top"], ["Top", "In list"]]);
    expect(units[1]?.headings?.map((heading) => [heading.title, heading.level])).toEqual([["In list", 2]]);
    expect(toDocumentOutline(units).map((section) => [section.path, section.startUnit, section.endUnit])).toEqual([
      [["Top"], 0, 3],
      [["Top", "In list"], 1, 3],
    ]);
  });

  it("lets an empty heading, or one whose text is all removed, head nothing", () => {
    const units = unitsOf([h(1, text("A")), h(2), h(2, text("Gone", [{ type: "struck" }])), h(2, text("B")), p("body")]);
    expect(units.at(-1)?.breadcrumb).toEqual(["A", "B"]);
    expect(units[1]?.headingLevel).toBeUndefined();
    expect(toDocumentOutline(units).map((section) => section.path)).toEqual([["A"], ["A", "B"]]);
  });

  it("titles a section by its heading, not the lede grouped with it", () => {
    const outline = toDocumentOutline(unitsOf([h(1, text("Title")), p("Lede")], true));
    expect(outline.map((section) => [section.heading, section.path])).toEqual([["Title", ["Title"]]]);
  });
});
