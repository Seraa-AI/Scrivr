/**
 * End-to-end walker tests — real `ServerEditor` + `StarterKit`, driven from
 * document JSON exactly as the collab server would (no Yjs, no canvas).
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";

function edit(content: Record<string, unknown>): ServerEditor {
  return new ServerEditor({ extensions: [StarterKit], content });
}

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const LONG = "x".repeat(250);

describe("toSemanticUnits — basic emission", () => {
  it("emits one body unit per paragraph", () => {
    const units = toSemanticUnits(edit({ type: "doc", content: [para("Hello world")] }));
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      type: "paragraph",
      role: "body",
      view: "proposed",
      order: 0,
      breadcrumb: [],
      text: "Hello world",
    });
    expect(units[0]!.markdown).toContain("Hello world");
    expect(units[0]!.nodeIds).toHaveLength(1);
  });

  it("emits one unit for an empty paragraph", () => {
    const units = toSemanticUnits(edit({ type: "doc", content: [{ type: "paragraph" }] }));
    // A single empty paragraph is still one unit; a truly empty doc isn't
    // constructible (schema requires block+), so this is the floor.
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ type: "paragraph", text: "" });
  });
});

describe("toSemanticUnits — cohesive-pair grouping", () => {
  it("groups a heading with a single short lede into one unit", () => {
    const units = toSemanticUnits(
      edit({ type: "doc", content: [heading(1, "Intro"), para("A short lede.")] }),
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ type: "heading", headingLevel: 1, breadcrumb: [] });
    expect(units[0]!.nodeIds).toHaveLength(2);
    expect(units[0]!.text).toContain("Intro");
    expect(units[0]!.text).toContain("A short lede.");
  });

  it("does not group a heading with a long body block", () => {
    const units = toSemanticUnits(
      edit({ type: "doc", content: [heading(1, "Intro"), para(LONG)] }),
    );
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[1]).toMatchObject({ type: "paragraph", breadcrumb: ["Intro"] });
  });

  it("does not group when a heading is followed by two body blocks", () => {
    const units = toSemanticUnits(
      edit({ type: "doc", content: [heading(1, "H"), para("one"), para("two")] }),
    );
    expect(units).toHaveLength(3);
    expect(units[0]!.type).toBe("heading");
    expect(units[1]).toMatchObject({ type: "paragraph", breadcrumb: ["H"] });
    expect(units[2]).toMatchObject({ type: "paragraph", breadcrumb: ["H"] });
  });

  it("emits a trailing heading as its own unit", () => {
    const units = toSemanticUnits(
      edit({ type: "doc", content: [para("body"), heading(2, "End")] }),
    );
    expect(units).toHaveLength(2);
    expect(units[1]).toMatchObject({ type: "heading", breadcrumb: [], text: "End" });
  });
});

describe("toSemanticUnits — breadcrumb stack", () => {
  it("nests body units under the active heading path", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [heading(1, "Top"), heading(2, "Sub"), para(LONG)],
      }),
    );
    expect(units).toHaveLength(3);
    expect(units[0]).toMatchObject({ type: "heading", headingLevel: 1, breadcrumb: [] });
    expect(units[1]).toMatchObject({ type: "heading", headingLevel: 2, breadcrumb: ["Top"] });
    expect(units[2]).toMatchObject({ type: "paragraph", breadcrumb: ["Top", "Sub"] });
  });

  it("pops sibling headings of equal or shallower level", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [heading(2, "A"), para(LONG), heading(2, "B"), para(LONG)],
      }),
    );
    // A sibling heading must NOT inherit the previous sibling in its own
    // breadcrumb, and the body under it sees only the current section.
    expect(units[0]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[1]).toMatchObject({ breadcrumb: ["A"] });
    expect(units[2]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[3]).toMatchObject({ breadcrumb: ["B"] });
  });

  it("gives a top-level heading an empty breadcrumb even mid-document", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [heading(1, "Part One"), para(LONG), heading(1, "Part Two"), para(LONG)],
      }),
    );
    // Both H1s are top-level — neither carries the other in its breadcrumb.
    expect(units[0]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[2]).toMatchObject({ type: "heading", breadcrumb: [] });
    expect(units[3]).toMatchObject({ breadcrumb: ["Part Two"] });
  });
});

describe("toSemanticUnits — lists and other blocks", () => {
  const listItem = (text: string) => ({ type: "listItem", content: [para(text)] });

  it("emits a whole bullet list as one unit", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [{ type: "bulletList", content: [listItem("a"), listItem("b")] }],
      }),
    );
    expect(units).toHaveLength(1);
    expect(units[0]!.type).toBe("list");
    expect(units[0]!.text).toContain("a");
    expect(units[0]!.text).toContain("b");
    expect(units[0]!.markdown).toContain("- a");
  });

  it("emits an ordered list with numeric markers", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [{ type: "orderedList", content: [listItem("first"), listItem("second")] }],
      }),
    );
    expect(units[0]!.type).toBe("list");
    expect(units[0]!.markdown).toContain("1.");
  });

  it("classifies codeBlock, horizontalRule, and pageBreak", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
          { type: "horizontalRule" },
          { type: "pageBreak" },
          para("after"),
        ],
      }),
    );
    expect(units.map((u) => u.type)).toEqual(["codeBlock", "horizontalRule", "pageBreak", "paragraph"]);
    expect(units[0]!.text).toContain("x = 1");
  });

  it("preserves hard breaks in plain text", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hello" },
              { type: "hardBreak" },
              { type: "text", text: "world" },
            ],
          },
        ],
      }),
    );
    expect(units[0]!.text).toBe("hello\nworld");
  });
});

describe("toSemanticUnits — parts (editable leaves)", () => {
  const listItem = (nodeId: string, text: string, marks?: Record<string, unknown>[]) => ({
    type: "listItem",
    content: [
      {
        type: "paragraph",
        attrs: { nodeId },
        content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
      },
    ],
  });
  const cell = (nodeId: string, text: string) => ({
    type: "tableCell",
    content: [{ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] }],
  });

  it("exposes each list item's paragraph as an addressable part", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          { type: "bulletList", content: [listItem("li1", "Basic tier"), listItem("li2", "Pro tier")] },
        ],
      }),
    );
    const list = units.find((u) => u.type === "list")!;
    expect(list.text).toContain("Basic tier");
    expect(list.parts).toEqual([
      { nodeId: "li1", type: "paragraph", breadcrumb: ["item 1"], text: "Basic tier" },
      { nodeId: "li2", type: "paragraph", breadcrumb: ["item 2"], text: "Pro tier" },
    ]);
  });

  it("part breadcrumb extends the unit's heading path", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          heading(1, "Pricing"),
          { type: "bulletList", content: [listItem("li1", "Basic tier")] },
        ],
      }),
    );
    const list = units.find((u) => u.type === "list")!;
    expect(list.parts![0]!.breadcrumb).toEqual(["Pricing", "item 1"]);
  });

  it("carries per-part spans when a leaf is formatted", () => {
    const units = toSemanticUnits(
      edit({
        type: "doc",
        content: [
          { type: "bulletList", content: [listItem("li1", "Bold item", [{ type: "bold" }])] },
        ],
      }),
    );
    const part = units.find((u) => u.type === "list")!.parts![0]!;
    expect(part.spans).toEqual([{ text: "Bold item", marks: [{ type: "bold" }] }]);
  });

  it("addresses table cells as parts with row/col breadcrumbs", () => {
    // Tables are an opt-in StarterKit preview, so enable the schema here.
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ table: true })],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { layout: "fixed", grid: [120, 120] },
            content: [
              { type: "tableRow", content: [cell("c1", "A1"), cell("c2", "B1")] },
              { type: "tableRow", content: [cell("c3", "A2"), cell("c4", "B2")] },
            ],
          },
        ],
      },
    });
    const units = toSemanticUnits(editor);
    const table = units.find((u) => u.type === "table")!;
    const byId = Object.fromEntries(table.parts!.map((p) => [p.nodeId, p.breadcrumb]));
    expect(byId["c1"]).toEqual(["row 1", "col 1"]);
    expect(byId["c4"]).toEqual(["row 2", "col 2"]);
    expect(table.parts!.find((p) => p.nodeId === "c4")!.text).toBe("B2");
  });

  it("a top-level leaf block has no parts (it is addressed as the unit)", () => {
    const units = toSemanticUnits(edit({ type: "doc", content: [para("just a paragraph")] }));
    expect(units[0]!.parts).toBeUndefined();
  });

  it("groupBlocks:false emits one unit per top-level block", () => {
    const grouped = toSemanticUnits(
      edit({ type: "doc", content: [heading(1, "Intro"), para("A short lede.")] }),
    );
    expect(grouped).toHaveLength(1); // cohesive pair

    const ungrouped = toSemanticUnits(
      edit({ type: "doc", content: [heading(1, "Intro"), para("A short lede.")] }),
      { groupBlocks: false },
    );
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped.map((u) => u.type)).toEqual(["heading", "paragraph"]);
  });
});
