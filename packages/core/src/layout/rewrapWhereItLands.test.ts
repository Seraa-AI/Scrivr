/**
 * A paragraph wraps the floats of the page it lands on, wherever a float above
 * it carries it.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { doc, image, must, p, partsOf, SHORT_PAGE as PAGE, SHORT_PAGE_BOTTOM, text, textLines, whole, words } from "../test/layoutOracle";
import { expectSamePosition } from "../test-utils";
import { isSpacerLine } from "./LineBreaker";

/**
 * A paragraph that wraps a float at the foot of page 1, then carried to page 2
 * by a top-and-bottom float above it.
 */
const moved = (subject: Node, next: Node = p("Next")): Node =>
  doc(
    p([text("Aaaa"), image({ wrapMode: "square", xAlign: "right", width: 250, height: 120, yOffset: 250 })]),
    p([text("Bbbb"), image({ wrapMode: "top-bottom", xAlign: "left", width: 100, height: 150 })]),
    ...Array.from({ length: 7 }, (_, i) => p(`F${i}`)),
    subject,
    next,
  );

describe("a wrapped paragraph that moves to a page with no float", () => {
  it("breaks its lines at the width it has there", () => {
    const subject = p(`Subject ${words(30)}`);
    const [part] = partsOf(whole(moved(subject), PAGE), "Subject");
    const [alone] = partsOf(whole(doc(subject), PAGE), "Subject");
    expect(part?.page).toBe(2);
    expect(textLines(must(part, "subject").block)).toEqual(textLines(must(alone, "subject alone").block));
  });

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
    expect(SHORT_PAGE_BOTTOM - (part.y + ink)).toBeLessThan(must(part.lines[0], "line").lineHeight);
  });

  it("is followed by the next paragraph after one gap", () => {
    const layout = whole(moved(p(`Subject ${words(30)}`)), PAGE);
    const subject = must(partsOf(layout, "Subject")[0], "subject").block;
    const next = must(partsOf(layout, "Next")[0], "next").block;
    expectSamePosition(next.y, subject.y + subject.height + Math.max(subject.spaceAfter, next.spaceBefore));
  });
});

describe("a wrapped paragraph that moves to a page with a float", () => {
  it("wraps that float", () => {
    const next = p([text("Next"), image({ wrapMode: "square", xAlign: "right", width: 300, height: 60, yOffset: -60 })]);
    const layout = whole(moved(p(`Subject ${words(30)}`), next), PAGE);
    const subject = must(partsOf(layout, "Subject")[0], "subject");
    const float = must(layout.anchoredObjects?.find((object) => object.page === subject.page), "float on its page");
    const beside: number[] = [];
    let y = subject.block.y;
    for (const line of subject.block.lines) {
      if (y + line.lineHeight > float.y && y < float.y + float.height) beside.push(subject.block.x + Math.max(...line.spans.map((span) => span.x + span.width)));
      y += line.lineHeight;
    }
    expect(beside).not.toEqual([]);
    for (const right of beside) expect(right).toBeLessThanOrEqual(float.x);
  });
});
