/**
 * A break belongs to its extension. These nodes are written only against
 * `@scrivr/core`'s public surface: one that starts a new page and one that
 * ends a line, with no engine change.
 */
import { describe, expect, it } from "vitest";
import { Extension, ExtensionManager, StarterKit, defaultPageConfig, runPipeline, type LayoutBlock } from "../index";
import { createMeasurer } from "../test-utils";

const Breaks = Extension.create({
  name: "customBreaks",
  addNodes() {
    return {
      sceneBreak: { group: "block", atom: true, layout: { kind: "break", breaks: "page" } },
      lineSeparator: { group: "inline", inline: true, selectable: false, layout: { kind: "break", breaks: "line" } },
      chapterBox: { group: "block", content: "block+", layout: { kind: "break", breaks: "page" } },
    };
  },
});

const manager = new ExtensionManager([StarterKit, Breaks]);

type Json = { type: string; content?: Json[]; text?: string };
const text = (value: string): Json => ({ type: "text", text: value });
const p = (...content: Json[]): Json => ({ type: "paragraph", content });

function pagesOf(content: Json[]): LayoutBlock[][] {
  const doc = manager.schema.nodeFromJSON({ type: "doc", content });
  const layout = runPipeline(doc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() });
  return layout.pages.map((page) => page.blocks);
}

const pageOf = (pages: LayoutBlock[][], value: string): number =>
  pages.findIndex((blocks) => blocks.some((block) => block.node.textContent === value)) + 1;

describe("a break from outside core", () => {
  it("starts the next block on a new page when it breaks the page", () => {
    expect(pageOf(pagesOf([p(text("before")), p(text("after"))]), "after")).toBe(1);
    expect(pageOf(pagesOf([p(text("before")), { type: "sceneBreak" }, p(text("after"))]), "after")).toBe(2);
  });

  it("lays out like the built-in page break", () => {
    const custom = pagesOf([p(text("before")), { type: "sceneBreak" }, p(text("after"))]);
    const builtIn = pagesOf([p(text("before")), { type: "pageBreak" }, p(text("after"))]);
    expect(custom.map((blocks) => blocks.map((block) => block.y))).toEqual(builtIn.map((blocks) => blocks.map((block) => block.y)));
  });

  it("is ignored on a node that holds content, which lays out in its place", () => {
    const pages = pagesOf([p(text("before")), { type: "chapterBox", content: [p(text("inside"))] }]);
    expect(pageOf(pages, "inside")).toBe(1);
  });

  it("ends the line when it breaks the line, as the built-in line break does", () => {
    const [custom] = pagesOf([p(text("one"), { type: "lineSeparator" }, text("two"))]);
    const [builtIn] = pagesOf([p(text("one"), { type: "hardBreak" }, text("two"))]);
    const textOf = (block: LayoutBlock | undefined) =>
      block?.lines.map((line) => line.spans.flatMap((span) => (span.kind === "text" ? [span.text] : [])).join(""));
    expect(textOf(custom?.[0])).toEqual(["one", "two"]);
    expect(custom?.[0]?.height).toBe(builtIn?.[0]?.height);
  });
});
