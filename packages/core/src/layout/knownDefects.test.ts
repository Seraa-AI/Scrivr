/**
 * What layout gets wrong today, each as the behaviour it should have. A test
 * here is expected to fail, and fails the suite when it starts to pass: take
 * its `.fails` off in the change that fixes it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import {
  cell, differencesFromWhole, doc, fixedWidths, FLOATING, h, image, p, row, SETUPS, sized, streamed, table, text, whole, words, type Setup,
} from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { isSpacerLine } from "./LineBreaker";
import { defaultPageConfig, type DocumentLayout, type LayoutPage } from "./PageLayout";

const PAGE: Setup = { pageConfig: { ...defaultPageConfig, pageHeight: 72 * 2 + 400 }, measurer: fixedWidths };
const PAGE_TOP = 72;
const PAGE_BOTTOM = PAGE_TOP + 400;

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
const lineText = (line: Block["lines"][number]): string => line.spans.map((span) => (span.kind === "text" ? span.text : "")).join("");
const textLines = (block: Block): string[] => block.lines.filter((line) => line.spans.length > 0).map(lineText);

describe("a streamed document with a float", () => {
  const names = ["a square float beside several paragraphs", "a float reaching back over the paragraph before", "a float beside a list", "a float before a table"];

  it.fails.each(names.flatMap((name) => Object.entries(SETUPS).filter(([setup]) => setup !== "no pages").map(([setup, options]): [string, string, Setup] => [name, setup, options])))(
    "is the whole document's layout: %s, %s",
    (name, _setup, options) => {
      const node = must(FLOATING[name], name);
      expect(differencesFromWhole(streamed(node, options, 1), node, options)).toEqual([]);
    },
  );
});

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

  it.fails("keeps its first-line indent", () => {
    const [part] = partsOf(whole(moved(p(`Subject ${words(30)}`, { textIndent: 60 })), PAGE), "Subject");
    expect(part?.page).toBe(2);
    expect(part?.block.lines.find((line) => line.spans.length > 0)?.spans[0]?.x).toBe(60);
  });

  it.fails("fills the page before it goes on to the next", () => {
    const [first, second] = partsOf(whole(moved(p(`Subject ${words(420)}`)), PAGE), "Subject");
    const part = must(first, "part on page 2").block;
    expect(second?.page).toBe(3);
    const ink = part.lines.filter((line) => !isSpacerLine(line)).reduce((sum, line) => sum + line.lineHeight, 0);
    expect(PAGE_BOTTOM - (part.y + ink)).toBeLessThan(must(part.lines[0], "line").lineHeight);
  });

  it.fails("is followed by the next paragraph after one gap", () => {
    const layout = whole(moved(p(`Subject ${words(30)}`)), PAGE);
    const subject = must(partsOf(layout, "Subject")[0], "subject").block;
    const next = must(partsOf(layout, "Next")[0], "next").block;
    expectSamePosition(next.y, subject.y + subject.height + Math.max(subject.spaceAfter, next.spaceBefore));
  });
});

describe("a table cell", () => {
  const blocksIn = (layout: DocumentLayout): Block[] => must(layout.pages[0]?.blocks[0]?.regions?.[0], "cell").blocks;

  it.fails("keeps one gap between two blocks, as the page does", () => {
    const inCell = blocksIn(whole(doc(table(row(cell(p("one"), h(2, "two"))))), PAGE));
    const [one, two] = [must(inCell[0], "one"), must(inCell[1], "two")];
    expectSamePosition(two.y, one.y + one.height + Math.max(one.spaceAfter, two.spaceBefore));
  });

  it.fails("keeps its first block's space before, as Word does", () => {
    const heading = must(blocksIn(whole(doc(table(row(cell(h(2, "one"), p("two"))))), PAGE))[0], "heading");
    const region = must(whole(doc(table(row(cell(h(2, "one"))))), PAGE).pages[0]?.blocks[0]?.regions?.[0], "cell");
    expectSamePosition(heading.y, region.inset.top + heading.spaceBefore);
  });
});

describe("a row taller than a page", () => {
  it.fails("starts a page of its own", () => {
    const tall = cell(...Array.from({ length: 40 }, (_, i) => p(`${i}`)));
    const layout = whole(doc(p("before"), table(row(tall)), p("after")), PAGE);
    expect(partsOf(layout, "0")[0]?.page).toBe(2);
  });
});

describe("a paragraph that wraps a float across two pages", () => {
  /** A tall word starts its third line on page 1, where it does not fit. */
  const crossing = (after: Node[]): Node =>
    doc(...Array.from({ length: 12 }, (_, i) => p(`F${i}`)), p([text(`Subject ${words(30)} `), sized("large words here", 40), text(` ${words(40)}`)]), ...after);
  const floatBelow = p([text("anchor"), image({ wrapMode: "square", xAlign: "right", width: 300, height: 100, yOffset: -60 })]);

  it.fails("breaks its lines on page 1 as it would without the float on page 2", () => {
    const plain = partsOf(whole(crossing([]), PAGE), "Subject");
    const wrapped = partsOf(whole(crossing([floatBelow]), PAGE), "Subject");
    expect(plain.map((part) => part.page)).toEqual([1, 2]);
    expect(textLines(must(wrapped[0], "first part").block)).toEqual(textLines(must(plain[0], "first part").block));
  });
});

describe("a wrapped paragraph that goes on to the next page", () => {
  it.fails("starts that page at its top", () => {
    const layout = whole(
      doc(
        ...Array.from({ length: 24 }, (_, i) => p(`F${i}`)),
        h(1, "Heading"),
        p(`Subject ${words(90)}`),
        p([text("anchor"), image({ wrapMode: "square", xAlign: "right", width: 300, height: 40, yOffset: -60 })]),
      ),
      PAGE,
    );
    const continuation = must(partsOf(layout, "Subject")[1], "second part").block;
    expectSamePosition(continuation.y, PAGE_TOP);
    expect(isSpacerLine(must(continuation.lines[0], "line"))).toBe(false);
  });
});

describe("a paragraph whose own float leaves it no line on the page", () => {
  const layout = (): DocumentLayout =>
    whole(
      doc(
        ...Array.from({ length: 9 }, (_, i) => p(`F${i}`)),
        p([text("Subject"), image({ wrapMode: "top-bottom", xAlign: "left", width: 100, height: 140 })]),
        p("next"),
      ),
      PAGE,
    );

  it.fails("puts nothing of it on that page but space", () => {
    for (const { block } of partsOf(layout(), "Subject")) expect(textLines(block).join("")).not.toBe("");
  });

  it.fails("takes the float with it, as Word does", () => {
    const subject = must(partsOf(layout(), "Subject").find((part) => textLines(part.block).join("") !== ""), "text");
    expect(layout().anchoredObjects?.[0]?.page).toBe(subject.page);
  });
});
