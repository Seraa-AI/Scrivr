/**
 * How much work laying a document out costs, counted rather than timed: every
 * `breakIntoLines` call is one block's lines broken.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, edit, inTurn, p, streamed, whole, words } from "../test/layoutOracle";
import { LineBreaker } from "./LineBreaker";
import { defaultPageConfig } from "./PageLayout";

const broken = vi.spyOn(LineBreaker.prototype, "breakIntoLines");
afterEach(() => broken.mockClear());

const BLOCKS = 200;
const long = doc(...Array.from({ length: BLOCKS }, (_, i) => p(`${i} ${words(30)}`)));
const setup = { pageConfig: defaultPageConfig };

const costOf = (run: () => unknown): number => {
  broken.mockClear();
  run();
  return broken.mock.calls.length;
};

describe("the work of laying a document out", () => {
  it("breaks each block's lines once", () => {
    expect(costOf(() => whole(long, setup))).toBe(BLOCKS);
  });

  it("breaks no more when the document is streamed", () => {
    expect(costOf(() => streamed(long, setup, 7))).toBe(BLOCKS);
  });

  it("breaks nothing again when nothing changed", () => {
    expect(costOf(() => inTurn([long, long], setup))).toBe(BLOCKS);
  });

  it.each([0, BLOCKS / 2, BLOCKS - 1])("breaks only the paragraph a letter is typed in, the one at index %i", (index) => {
    let pos = 1;
    for (let i = 0; i < index; i++) pos += long.child(i).nodeSize;
    const typed = edit(long, (tr) => tr.insertText("z", pos));
    expect(costOf(() => inTurn([long, typed], setup))).toBe(BLOCKS + 1);
  });

  it("breaks nothing again for a block deleted", () => {
    const shorter = edit(long, (tr) => tr.delete(0, long.child(0).nodeSize));
    expect(costOf(() => inTurn([long, shorter], setup))).toBe(BLOCKS);
  });
});
