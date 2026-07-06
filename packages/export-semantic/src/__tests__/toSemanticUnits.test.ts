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
    // Second H2 replaces the first on the stack — B's body sees only ["B"].
    expect(units[1]).toMatchObject({ breadcrumb: ["A"] });
    expect(units[3]).toMatchObject({ breadcrumb: ["B"] });
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
});
