/**
 * A paragraph wraps the floats of the page it lands on, wherever a float above
 * it carries it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { doc, fixedWidths, image, p, text, whole, words, type Setup } from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { isSpacerLine } from "./LineBreaker";
import { defaultPageConfig, type DocumentLayout, type LayoutPage } from "./PageLayout";

const PAGE: Setup = { pageConfig: { ...defaultPageConfig, pageHeight: 72 * 2 + 400 }, measurer: fixedWidths };
const PAGE_BOTTOM = 72 + 400;

type Block = LayoutPage["blocks"][number];

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
};

/** The parts of the block holding `start`, with the page each is on. */
const partsOf = (layout: DocumentLayout, start: string): { page: number; block: Block }[] =>
  layout.pages.flatMap((page) =>
    page.blocks.filter((block) => block.node.textContent.startsWith(start)).map((block) => ({ page: page.pageNumber, block })),
  );

/**
 * A paragraph that wraps a float at the foot of page 1, then carried to page 2
 * by a top-and-bottom float above it.
 */
describe("a wrapped paragraph that moves to a page with no float", () => {
  const moved = (subject: Node): Node =>
    doc(
      p([text("Aaaa"), image({ wrapMode: "square", xAlign: "right", width: 250, height: 120, yOffset: 250 })]),
      p([text("Bbbb"), image({ wrapMode: "top-bottom", xAlign: "left", width: 100, height: 150 })]),
      ...Array.from({ length: 7 }, (_, i) => p(`F${i}`)),
      subject,
      p("Next"),
    );

  it("keeps its first-line indent", () => {
    const [part] = partsOf(whole(moved(p(`Subject ${words(30)}`, { textIndent: 60 })), PAGE), "Subject");
    expect(part?.page).toBe(2);
    expect(part?.block.lines.find((line) => line.spans.length > 0)?.spans[0]?.x).toBe(60);
  });

  it("fills the page before it goes on to the next", () => {
    const [first, second] = partsOf(whole(moved(p(`Subject ${words(420)}`)), PAGE), "Subject");
    const part = must(first, "part on page 2").block;
    expect(second?.page).toBe(3);
    const ink = part.lines.filter((line) => !isSpacerLine(line)).reduce((sum, line) => sum + line.lineHeight, 0);
    expect(PAGE_BOTTOM - (part.y + ink)).toBeLessThan(must(part.lines[0], "line").lineHeight);
  });

  it("is followed by the next paragraph after one gap", () => {
    const layout = whole(moved(p(`Subject ${words(30)}`)), PAGE);
    const subject = must(partsOf(layout, "Subject")[0], "subject").block;
    const next = must(partsOf(layout, "Next")[0], "next").block;
    expectSamePosition(next.y, subject.y + subject.height + Math.max(subject.spaceAfter, next.spaceBefore));
  });

  it("wraps the float of the page it moves to", () => {
    const node = doc(
      p([text("Aaaa"), image({ wrapMode: "square", xAlign: "right", width: 250, height: 120, yOffset: 250 })]),
      p([text("Bbbb"), image({ wrapMode: "top-bottom", xAlign: "left", width: 100, height: 150 })]),
      ...Array.from({ length: 7 }, (_, i) => p(`F${i}`)),
      p(`Subject ${words(30)}`),
      p([text("Next"), image({ wrapMode: "square", xAlign: "right", width: 300, height: 60, yOffset: -60 })]),
    );
    const layout = whole(node, PAGE);
    const subject = must(partsOf(layout, "Subject")[0], "subject");
    const float = must(layout.anchoredObjects?.find((object) => object.page === subject.page), "float on its page");
    let y = subject.block.y;
    for (const line of subject.block.lines) {
      if (y + line.lineHeight > float.y && y < float.y + float.height) {
        const right = Math.max(...line.spans.map((span) => span.x + span.width));
        expect(subject.block.x + right).toBeLessThanOrEqual(float.x);
      }
      y += line.lineHeight;
    }
  });
});
