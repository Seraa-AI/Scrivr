/**
 * A block that cannot split and is taller than a page starts a page of its own,
 * as Word starts a row that may not break, and what follows goes on after it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import {
  cell, differencesFromWhole, doc, image, inTurn, must, p, pageBreak, partsOf, row, SETUPS, SHORT_PAGE as PAGE, SHORT_PAGE_TOP as PAGE_TOP, streamed, table, text, whole,
} from "../test/layoutOracle";
import { defaultPagelessConfig, type DocumentLayout } from "./PageLayout";


const tallCell = (): Node => cell(...Array.from({ length: 40 }, (_, i) => p(`${i}`)));

/** The page and y of the block whose text starts with `start`. */
const at = (layout: DocumentLayout, start: string): { page: number; y: number } | undefined => {
  const part = partsOf(layout, start)[0];
  return part && { page: part.page, y: part.block.y };
};

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

  it("does not move without pages", () => {
    const layout = whole(node, { pageConfig: defaultPagelessConfig });
    expect(layout.pages).toHaveLength(1);
  });

  it.each(Object.entries(SETUPS))("has one layout however it is arrived at: %s", (_name, setup) => {
    expect(differencesFromWhole(streamed(node, setup, 1), node, setup)).toEqual([]);
    expect(differencesFromWhole(inTurn([node, node], setup), node, setup)).toEqual([]);
  });

  const square = (attrs: Record<string, unknown> = {}): Node => image({ wrapMode: "square", xAlign: "right", width: 100, height: 60, ...attrs });

  it("leaves a float after it on its own paragraph's page", () => {
    const layout = whole(doc(p("before"), table(row(tallCell())), p("after"), p([text("anchor"), square()])), PAGE);
    expect(layout.anchoredObjects?.map((float) => float.page)).toEqual([at(layout, "anchor")?.page]);
  });

  it.each<[string, Node[]]>([
    ["the document's first page", []],
    ["the page after a break", [p("first"), pageBreak()]],
  ])("stays at the top of a page that holds only a float's anchor: %s", (_name, before) => {
    const anchorOnly = p([image({ wrapMode: "behind", width: 100, height: 100 })]);
    const node = doc(...before, anchorOnly, table(row(tallCell())), p("after"), p([text("anchor"), square()]));
    const layout = whole(node, PAGE);
    expect(at(layout, "0")).toEqual({ page: before.length > 0 ? 2 : 1, y: PAGE_TOP });
    expect(layout.anchoredObjects?.at(-1)?.page).toBe(at(layout, "anchor")?.page);
    expect(differencesFromWhole(streamed(node, PAGE, 1), node, PAGE)).toEqual([]);
  });

  it("does not stop the rows after it moving clear of a float", () => {
    const node = doc(table(row(tallCell()), row(cell(p("second row")))), p([text("anchor"), square({ xAlign: "left", width: 150, yOffset: -140 })]));
    const layout = whole(node, PAGE);
    const second = must(partsOf(layout, "second row")[0], "second row");
    const float = must(layout.anchoredObjects?.[0], "float");
    const overlap = float.page === second.page && float.y < second.block.y + second.block.height && second.block.y < float.y + float.height;
    expect(overlap).toBe(false);
  });

  it("moves clear of a float above it whatever floats follow on the next page", () => {
    const node = doc(p([text("first"), square({ height: 160 })]), table(row(tallCell())), p([text("anchor"), square()]));
    const layout = whole(node, PAGE);
    const tall = at(layout, "0");
    expect(tall).toEqual({ page: 2, y: PAGE_TOP });
    expect(layout.anchoredObjects?.map((float) => float.page)).toEqual([1, at(layout, "anchor")?.page]);
  });
});

describe("a line taller than a page", () => {
  it("is followed by the next block on the page after it", () => {
    const huge = p([image({ width: 40, height: 1300, wrapMode: "inline" })]);
    const layout = whole(doc(p("before"), huge, p("after")), PAGE);
    expect(layout.pages).toHaveLength(3);
    expect(at(layout, "after")).toEqual({ page: 3, y: PAGE_TOP });
  });
});
