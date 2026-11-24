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
