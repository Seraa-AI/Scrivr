/**
 * A block that cannot split and is taller than a page starts a page of its own,
 * as Word starts a row that may not break, and what follows goes on after it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { cell, differencesFromWhole, doc, fixedWidths, image, inTurn, p, row, SETUPS, streamed, table, whole, type Setup } from "../test/layoutOracle";
import { defaultPageConfig, defaultPagelessConfig, type DocumentLayout } from "./PageLayout";

const PAGE: Setup = { pageConfig: { ...defaultPageConfig, pageHeight: 72 * 2 + 400 }, measurer: fixedWidths };
const PAGE_TOP = 72;

const tallCell = (): Node => cell(...Array.from({ length: 40 }, (_, i) => p(`${i}`)));

/** The page and y of the block whose text starts with `start`. */
const at = (layout: DocumentLayout, start: string): { page: number; y: number } | undefined =>
  layout.pages.flatMap((page) =>
    page.blocks.filter((block) => block.node.textContent.startsWith(start)).map((block) => ({ page: page.pageNumber, y: block.y })),
  )[0];

describe("a row taller than a page", () => {
  const node = doc(p("before"), table(row(tallCell())), p("after"));

  it("starts a page of its own", () => {
    expect(at(whole(node, PAGE), "0")).toEqual({ page: 2, y: PAGE_TOP });
  });

  it("is followed by the next block on the page after it", () => {
    expect(at(whole(node, PAGE), "after")).toEqual({ page: 3, y: PAGE_TOP });
  });

  it("stays where it is at the top of a page", () => {
    expect(at(whole(doc(table(row(tallCell())), p("after")), PAGE), "0")).toEqual({ page: 1, y: PAGE_TOP });
  });

  it("takes a page for each when two follow one another", () => {
    const two = whole(doc(p("before"), table(row(tallCell()), row(cell(p("second"), ...Array.from({ length: 40 }, () => p("line")))))), PAGE);
    expect([at(two, "0")?.page, at(two, "second")?.page]).toEqual([2, 3]);
  });

  it("has the space after it start the next page, as a line taller than a page does", () => {
    const huge = p([image({ width: 40, height: 1300, wrapMode: "inline" })]);
    const layout = whole(doc(p("before"), huge, p("after")), PAGE);
    expect(layout.pages).toHaveLength(3);
    expect(at(layout, "after")).toEqual({ page: 3, y: PAGE_TOP });
  });

  it("does not move without pages", () => {
    const layout = whole(node, { pageConfig: defaultPagelessConfig, measurer: fixedWidths });
    expect(layout.pages).toHaveLength(1);
  });

  it.each(Object.entries(SETUPS))("has one layout however it is arrived at: %s", (_name, setup) => {
    expect(differencesFromWhole(streamed(node, setup, 1), node, setup)).toEqual([]);
    expect(differencesFromWhole(inTurn([node, node], setup), node, setup)).toEqual([]);
  });
});
