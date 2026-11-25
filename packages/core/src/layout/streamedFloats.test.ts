/**
 * A chunk starts over from an earlier page when a float crosses the cutoff, and
 * from a page that starts with a block of its own.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { cell, differencesFromWhole, doc, image, p, row, SHORT_PAGE as PAGE, streamed, table, text, words } from "../test/layoutOracle";

const square = (height: number, yOffset = 0, margin?: number): Node =>
  image({ wrapMode: "square", xAlign: "right", width: 300, height, yOffset, ...(margin !== undefined ? { margin } : {}) });
const fillers = (count: number): Node[] => Array.from({ length: count }, (_, i) => p(`F${i}`));
const rows = (count: number): Node => table(...Array.from({ length: count }, (_, i) => row(cell(p(`r${i}`)), cell(p("b")))));

const expectStreamedAsWhole = (node: Node): void => {
  for (const blocks of [1, 2, 3]) expect(differencesFromWhole(streamed(node, PAGE, blocks), node, PAGE)).toEqual([]);
};

describe("a float that crosses the streaming cutoff", () => {
  it.each<[string, Node]>([
    ["by the room it keeps clear below it alone", doc(p([square(16), text("one")]), p(words(40)))],
    ["by a margin of its own, over a whole paragraph", doc(p([square(16, 0, 60), text("one")]), p("two"), p(words(40)))],
    ["back over a paragraph that goes on from the page before", doc(...fillers(13), p(words(60)), p([text("anchor"), square(40, -30)]), p(words(30)))],
    ["from a paragraph that goes on from the page before", doc(...fillers(13), p([text(words(60)), square(40, 40)]), p(words(30)))],
    ["beside a table it is above", doc(p([text("anchor"), square(80)]), rows(3), p("end"))],
    ["beside a table it reaches back over", doc(rows(3), p([text("anchor"), square(60, -50)]), p("end"))],
    ["which the table moves below and back", doc(...fillers(9), p([text(`anchor ${words(6)}`), image({ wrapMode: "top-bottom", width: 150, height: 150, yOffset: -20 })]), rows(2), p("end"))],
  ])("is wrapped on both sides of it: %s", (_name, node) => {
    expectStreamedAsWhole(node);
  });
});
