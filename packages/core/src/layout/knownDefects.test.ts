/**
 * What layout gets wrong today, each as the behaviour it should have. A test
 * here is expected to fail, and fails the suite when it starts to pass: take
 * its `.fails` off in the change that fixes it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import {
  differencesFromWhole, doc, h, image, must, p, partsOf, SHORT_PAGE as PAGE, SHORT_PAGE_TOP, sized, streamed, text, textLines, whole, words,
} from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { isSpacerLine } from "./LineBreaker";
import { defaultPagelessConfig, type DocumentLayout } from "./PageLayout";

const float = (wrapMode: string, xAlign: string, width: number, height: number, yOffset = 0): Node =>
  image({ wrapMode, xAlign, width, height, yOffset });

describe("a paragraph that wraps a float across two pages", () => {
  /** A tall word starts its third line on page 1, where it does not fit. */
  const crossing = (after: Node[]): Node =>
    doc(...Array.from({ length: 12 }, (_, i) => p(`F${i}`)), p([text(`Subject ${words(30)} `), sized("large words here", 40), text(` ${words(40)}`)]), ...after);

  it.fails("breaks its lines on page 1 as it would without the float on page 2", () => {
    const plain = partsOf(whole(crossing([]), PAGE), "Subject");
    const wrapped = partsOf(whole(crossing([p([text("anchor"), float("square", "right", 300, 100, -60)])]), PAGE), "Subject");
    expect(plain.map((part) => part.page)).toEqual([1, 2]);
    expect(textLines(must(wrapped[0], "first part").block)).toEqual(textLines(must(plain[0], "first part").block));
  });
});

describe("a wrapped paragraph that goes on to the next page", () => {
  it.fails("starts that page at its top", () => {
    const layout = whole(
      doc(...Array.from({ length: 24 }, (_, i) => p(`F${i}`)), h(1, "Heading"), p(`Subject ${words(90)}`), p([text("anchor"), float("square", "right", 300, 40, -60)])),
      PAGE,
    );
    const continuation = must(partsOf(layout, "Subject")[1], "second part").block;
    expectSamePosition(continuation.y, SHORT_PAGE_TOP);
    expect(isSpacerLine(must(continuation.lines[0], "line"))).toBe(false);
  });

  it.fails("keeps no space at the foot of the page it leaves", () => {
    const layout = whole(
      doc(p([text(words(41)), float("square", "left", 340, 120, -130)]), p([text(words(51)), float("top-bottom", "right", 240, 190, -30)]), p(words(57)), p(`Subject ${words(18)}`)),
      PAGE,
    );
    const left = must(partsOf(layout, "Subject")[0], "first part").block;
    expect(left.continuesOnNextPage).toBe(true);
    expect(isSpacerLine(must(left.lines.at(-1), "line"))).toBe(false);
  });
});

describe("a paragraph whose own float leaves it no line on the page", () => {
  const layout = (): DocumentLayout =>
    whole(doc(...Array.from({ length: 9 }, (_, i) => p(`F${i}`)), p([text("Subject"), float("top-bottom", "left", 100, 140)]), p("next")), PAGE);

  it.fails("leaves no part of it that holds only space", () => {
    const parts = partsOf(layout(), "Subject").map((part) => textLines(part.block).join(""));
    expect(parts).toEqual(["Subject"]);
  });

  it.fails("takes the float with it, as Word does", () => {
    const subject = must(partsOf(layout(), "Subject").find((part) => textLines(part.block).join("") !== ""), "text");
    expect(layout().anchoredObjects?.[0]?.page).toBe(subject.page);
  });
});

describe("a streamed document whose floats reach back over one another", () => {
  it.fails("places them as the whole document does", () => {
    const node = doc(
      p([text(`P0 ${words(25)}`), float("square", "left", 240, 120, -150)]),
      p([text(`P1 ${words(45)}`), float("square", "right", 140, 40, -170)]),
      p([text(`P2 ${words(13)}`), float("top-bottom", "left", 160, 100, 60)]),
      p([text(`P3 ${words(44)}`), float("top-bottom", "left", 100, 110, -90)]),
    );
    expect(differencesFromWhole(streamed(node, PAGE, 2), node, PAGE)).toEqual([]);
  });
});

describe("a document without pages", () => {
  const pageless = { ...PAGE, pageConfig: defaultPagelessConfig };

  it.fails("wraps text beside a float", () => {
    const layout = whole(doc(p([float("square", "right", 300, 100), text(words(60))])), pageless);
    const placed = must(layout.anchoredObjects?.[0], "float");
    const block = must(layout.pages[0]?.blocks[0], "paragraph");
    const right = block.x + Math.max(...(block.lines[0]?.spans ?? []).map((span) => span.x + (span.kind === "text" ? span.text.trimEnd().length * 7 : span.width)));
    expect(right).toBeLessThanOrEqual(placed.x);
  });

  it.fails("stacks a streamed float clear of one in an earlier chunk", () => {
    const node = doc(p([text("a"), float("square", "right", 200, 150)]), p([text("b"), float("square", "right", 200, 150)]));
    expect(differencesFromWhole(streamed(node, pageless, 1), node, pageless)).toEqual([]);
  });
});
