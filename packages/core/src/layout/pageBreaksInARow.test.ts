/**
 * Floats, and the text that wraps them, are placed on the pages the text is
 * painted on, however many breaks there are before them.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { differencesFromWhole, doc, h, image, p, pageBreak, partsOf, sectionBreak, SHORT_PAGE as PAGE, streamed, text, whole } from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";

const anchored = (): Node => p([text("anchor"), image({ wrapMode: "square", xAlign: "right", width: 200, height: 60 })]);
const anchorOnly = (): Node => p([image({ wrapMode: "behind", width: 100, height: 100 })]);
const fillingAPage = (): Node[] => Array.from({ length: 14 }, (_, i) => p(`F${i}`));

describe("a float after page breaks", () => {
  it.each<[string, Node[], number]>([
    ["one break", [p("one"), pageBreak()], 2],
    ["two in a row", [p("one"), pageBreak(), pageBreak()], 3],
    ["three in a row", [p("one"), pageBreak(), pageBreak(), pageBreak()], 4],
    ["two before any text", [pageBreak(), pageBreak()], 3],
    ["a break after a section that starts a page", [p("one"), sectionBreak("nextPage"), pageBreak()], 3],
    ["a section that starts an odd page after a break", [p("one"), pageBreak(), sectionBreak("oddPage")], 3],
    ["a break after a page that holds only an anchor", [p("one"), pageBreak(), anchorOnly(), pageBreak()], 3],
    ["a break after a full page", [...fillingAPage(), pageBreak()], 2],
  ])("is on its paragraph's page: %s", (_name, before, page) => {
    const node = doc(...before, anchored(), p("next"));
    const layout = whole(node, PAGE);
    expect(partsOf(layout, "anchor")[0]?.page).toBe(page);
    expect(layout.anchoredObjects?.at(-1)?.page).toBe(page);
    for (const blocks of [1, 2]) expect(differencesFromWhole(streamed(node, PAGE, blocks), node, PAGE)).toEqual([]);
  });

  it("keeps the space above a block that follows only an anchor at the page top", () => {
    const layout = whole(doc(anchorOnly(), h(2, "Heading"), anchored()), PAGE);
    const heading = partsOf(layout, "Heading")[0]?.block;
    const float = layout.anchoredObjects?.at(-1);
    const anchor = partsOf(layout, "anchor")[0]?.block;
    if (!heading || !float || !anchor) throw new Error("missing a block or the float");
    expectSamePosition(heading.y, 72 + heading.spaceBefore);
    expectSamePosition(float.y, anchor.y);
  });
});
