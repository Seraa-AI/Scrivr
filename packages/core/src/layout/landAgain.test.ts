/**
 * Where a paragraph lands is decided by the lines it has there, never by ones
 * laid out around a float that has since moved away.
 */
import { describe, expect, it } from "vitest";
import { cell, doc, fixedWidths, image, p, row, table, text, whole, words, type Setup } from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { defaultPageConfig } from "./PageLayout";

const PAGE: Setup = { pageConfig: { ...defaultPageConfig, pageHeight: 72 * 2 + 400 }, measurer: fixedWidths };

const rows = (count: number) => table(...Array.from({ length: count }, (_, i) => row(cell(p(`r${i}`)), cell(p("b")))));
const reachingBack = (yOffset: number) => p([text(`anchor ${words(6)}`), image({ wrapMode: "top-bottom", xAlign: "right", width: 150, height: 150, yOffset })]);

describe("a paragraph after a table that a float moved and left", () => {
  it.each([[-20, 2], [-40, 2], [-20, 3], [-40, 3]])("follows the table on its page (yOffset %i, %i rows)", (yOffset, count) => {
    const layout = whole(doc(p("F0"), p("F1"), reachingBack(yOffset), rows(count), p("end")), PAGE);
    const blocks = layout.pages[0]?.blocks ?? [];
    const [before, end] = [blocks.at(-2), blocks.at(-1)];
    if (!before || !end) throw new Error("no last block");
    expect(end.node.textContent).toBe("end");
    expectSamePosition(end.y, before.y + before.height + Math.max(before.spaceAfter, end.spaceBefore));
  });
});
