/** Blocks in a table cell keep the space between them that blocks on a page do. */
import { describe, it } from "vitest";
import { cell, doc, fixedWidths, h, image, p, row, table, whole, type Setup } from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { defaultPageConfig, type DocumentLayout, type LayoutPage } from "./PageLayout";

const PAGE: Setup = { pageConfig: defaultPageConfig, measurer: fixedWidths };

type Block = LayoutPage["blocks"][number];

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
};

describe("a table cell", () => {
  const blocksIn = (layout: DocumentLayout): Block[] => must(layout.pages[0]?.blocks[0]?.regions?.[0], "cell").blocks;

  it("keeps one gap between two blocks, as the page does", () => {
    const inCell = blocksIn(whole(doc(table(row(cell(p("one"), h(2, "two"))))), PAGE));
    const [one, two] = [must(inCell[0], "one"), must(inCell[1], "two")];
    expectSamePosition(two.y, one.y + one.height + Math.max(one.spaceAfter, two.spaceBefore));
  });

  it("keeps its first block's space before, as Word does", () => {
    const heading = must(blocksIn(whole(doc(table(row(cell(h(2, "one"), p("two"))))), PAGE))[0], "heading");
    const region = must(whole(doc(table(row(cell(h(2, "one"))))), PAGE).pages[0]?.blocks[0]?.regions?.[0], "cell");
    expectSamePosition(heading.y, region.inset.top + heading.spaceBefore);
  });

  it("keeps its last block's space after, as Word does", () => {
    const layout = whole(doc(table(row(cell(p("one"))))), PAGE);
    const region = must(layout.pages[0]?.blocks[0]?.regions?.[0], "cell");
    const one = must(region.blocks[0], "one");
    expectSamePosition(region.height, one.y + one.height + one.spaceAfter + region.inset.bottom);
  });

  it("spaces a nested table's blocks the same way", () => {
    const layout = whole(doc(table(row(cell(p("before"), table(row(cell(p("one"), h(2, "two")))))))), PAGE);
    const inner = must(layout.pages[0]?.blocks[0]?.regions?.[0]?.blocks[1]?.regions?.[0], "inner cell").blocks;
    const [one, two] = [must(inner[0], "one"), must(inner[1], "two")];
    expectSamePosition(two.y, one.y + one.height + Math.max(one.spaceAfter, two.spaceBefore));
  });

  it("gives no space of its own to a paragraph that only anchors a float", () => {
    const anchor = p([image({ wrapMode: "behind", width: 20, height: 20 })]);
    const inCell = blocksIn(whole(doc(table(row(cell(p("one"), anchor, h(2, "two"))))), PAGE));
    const [one, holder, two] = [must(inCell[0], "one"), must(inCell[1], "anchor"), must(inCell[2], "two")];
    expectSamePosition(holder.y, one.y + one.height + one.spaceAfter);
    expectSamePosition(two.y, holder.y + two.spaceBefore);
  });
});
