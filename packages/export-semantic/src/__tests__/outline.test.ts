/**
 * The section hierarchy the headings imply.
 *
 * `toSemanticUnits` returns an ordered flat list. The tree behind it was being
 * rebuilt by each consumer — opening and closing sections on heading level,
 * threading ancestor titles, naming the content that precedes the first real
 * heading — so two places could disagree about what a section is.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../toSemanticUnits";
import { toDocumentOutline } from "../outline";

const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const outlineOf = (content: Record<string, unknown>[], options = {}) => {
  const editor = new ServerEditor({
    extensions: [StarterKit],
    content: { type: "doc", content },
  });
  return {
    units: toSemanticUnits(editor, { groupBlocks: false }),
    sections: toDocumentOutline(toSemanticUnits(editor, { groupBlocks: false }), options),
  };
};

describe("toDocumentOutline", () => {
  it("is empty for a document with no units", () => {
    expect(toDocumentOutline([])).toEqual([]);
  });

  it("opens a section at each heading, in document order", () => {
    const { sections } = outlineOf([
      heading(1, "One"),
      para("a"),
      heading(1, "Two"),
      para("b"),
    ]);

    expect(sections.map((s) => s.heading)).toEqual(["One", "Two"]);
  });

  it("nests a deeper heading under the one it follows", () => {
    const { sections } = outlineOf([
      heading(1, "Liability"),
      heading(2, "Exclusions"),
      para("a"),
    ]);

    expect(sections.map((s) => s.path)).toEqual([
      ["Liability"],
      ["Liability", "Exclusions"],
    ]);
    expect(sections[1]!.parentId).toBe(sections[0]!.id);
    expect(sections[0]!.parentId).toBeNull();
  });

  it("closes every open section at the new heading's level or deeper", () => {
    const { sections } = outlineOf([
      heading(1, "One"),
      heading(2, "One.A"),
      heading(3, "One.A.i"),
      heading(2, "One.B"),
    ]);

    const byHeading = new Map(sections.map((s) => [s.heading, s]));
    expect(byHeading.get("One.B")!.path).toEqual(["One", "One.B"]);
    expect(byHeading.get("One.B")!.parentId).toBe(byHeading.get("One")!.id);
  });

  it("makes a section's range heading-inclusive, ending where the next opens", () => {
    const { units, sections } = outlineOf([
      heading(1, "One"),
      para("a"),
      para("b"),
      heading(1, "Two"),
      para("c"),
    ]);
    const [first, second] = sections;

    expect(units[first!.startUnit]!.text).toBe("One");
    expect(first!.endUnit).toBe(second!.startUnit);
    expect(second!.endUnit).toBe(units.length);
  });

  it("gives an outer section the full range of its children", () => {
    const { units, sections } = outlineOf([
      heading(1, "One"),
      heading(2, "One.A"),
      para("a"),
      heading(1, "Two"),
    ]);
    const outer = sections.find((s) => s.heading === "One")!;

    expect(units[outer.endUnit]!.text).toBe("Two");
  });

  it("makes content before the first heading a section and names it", () => {
    const { sections } = outlineOf([para("preamble"), heading(1, "One")]);

    expect(sections[0]!.heading).toBe("Document body");
    expect(sections[0]!.headingNodeId).toBeNull();
    expect(sections[0]!.endUnit).toBe(sections[1]!.startUnit);
  });

  it("lets the host supply that name, since it is text a reader sees", () => {
    const { sections } = outlineOf([para("preamble")], { untitledHeading: "Preamble" });

    expect(sections[0]!.heading).toBe("Preamble");
  });

  it("opens no synthetic section when the document starts with a heading", () => {
    const { sections } = outlineOf([heading(1, "One"), para("a")]);

    expect(sections.map((s) => s.heading)).toEqual(["One"]);
  });

  it("covers a document that has no headings at all", () => {
    const { units, sections } = outlineOf([para("a"), para("b")]);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.endUnit).toBe(units.length);
  });

  it("anchors a section to the heading block a citation can point at", () => {
    const { units, sections } = outlineOf([heading(1, "One"), para("a")]);

    expect(sections[0]!.headingNodeId).toBe(units[0]!.nodeIds[0]);
    expect(sections[0]!.id).toBe(units[0]!.id);
  });

  it("agrees with the breadcrumb the units already carry", () => {
    // One owner for "which headings am I under": the outline reads the
    // walker's breadcrumb rather than re-deriving the stack, so a section's
    // path and its units' breadcrumbs cannot drift apart.
    const { units, sections } = outlineOf([
      heading(1, "One"),
      heading(2, "One.A"),
      para("body"),
    ]);
    const deepest = sections.find((s) => s.heading === "One.A")!;
    const body = units[deepest.startUnit + 1]!;

    expect(body.breadcrumb).toEqual(deepest.path);
  });

  it("returns the same outline for the same document, read twice", () => {
    // Section ids are what every cached chunk anchor hangs off. A read that
    // minted fresh identity would break all of them.
    const content = [heading(1, "One"), para("a"), heading(2, "One.A")];

    expect(outlineOf(content).sections).toEqual(outlineOf(content).sections);
  });
});
