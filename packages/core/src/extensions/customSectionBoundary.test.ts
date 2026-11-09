/**
 * Where a section ends belongs to the extension whose node ends it. This one
 * is written only against `@scrivr/core`'s public surface: a chapter end that
 * declares `sectionBoundary` and carries the settings of the section it ends,
 * with no engine change.
 */
import { describe, expect, it } from "vitest";
import { Extension, ExtensionManager, StarterKit, defaultPageConfig, deriveSections, runPipeline, type LayoutBlock } from "../index";
import { createMeasurer } from "../test-utils";

const Chapters = Extension.create({
  name: "chapters",
  addNodes() {
    return {
      chapterEnd: {
        group: "block",
        atom: true,
        sectionBoundary: true,
        attrs: { settings: { default: null } },
        toDOM: () => ["hr"],
      },
    };
  },
});

const manager = new ExtensionManager([StarterKit.configure({ sections: false }), Chapters]);

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const chapterEnd = (breakType: string): Json => ({ type: "chapterEnd", attrs: { settings: { breakType, columns: { count: 1, gap: 24 } } } });

const docOf = (content: Json[]) => manager.schema.nodeFromJSON({ type: "doc", content });

function pagesOf(content: Json[]): LayoutBlock[][] {
  const layout = runPipeline(docOf(content), { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
  return layout.pages.map((page) => page.blocks);
}

const placeOf = (pages: LayoutBlock[][], text: string) => {
  const page = pages.findIndex((blocks) => blocks.some((block) => block.node.textContent === text));
  return { page: page + 1, y: pages[page]?.find((block) => block.node.textContent === text)?.y };
};

describe("a section boundary from outside core", () => {
  it("ends a section, carrying the settings of the section it ends", () => {
    const sections = deriveSections(docOf([p("one"), chapterEnd("nextPage"), p("two")]));
    expect(sections.map((section) => section.settings.breakType)).toEqual(["nextPage", "nextPage"]);
    expect(sections).toHaveLength(2);
  });

  it("starts the next section on a new page unless it is continuous", () => {
    expect(placeOf(pagesOf([p("one"), chapterEnd("nextPage"), p("two")]), "two").page).toBe(2);
    expect(placeOf(pagesOf([p("one"), chapterEnd("oddPage"), p("two")]), "two").page).toBe(3);
  });

  it("does not move the flow when the next section is continuous", () => {
    const without = placeOf(pagesOf([p("one"), p("two")]), "two");
    expect(placeOf(pagesOf([p("one"), chapterEnd("continuous"), p("two")]), "two")).toEqual(without);
  });
});
