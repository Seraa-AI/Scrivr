import { describe, it, expect } from "vitest";
import { buildPdf } from "../index";
import { normalizeDrawNumber, recordDrawOps, type DrawOp } from "./opLog";
import { block, exportEditor, onePage, textLine } from "./fixtures";

/**
 * Proof that the baseline can fail.
 *
 * A harness diffed against a baseline it generated itself is green by
 * construction: it passes whether or not it records the things a migration is
 * likely to break. So each perturbation below is a change the next phases could
 * plausibly introduce, applied to a real recorded log, and the log is required
 * to notice it. If a field stops being recorded, the matching test here goes
 * green-by-accident and fails.
 *
 * These are transforms over the recorded stream rather than edits to the
 * exporter, because what is under test is the *representation's resolution* —
 * whether the recorded form distinguishes two renderings — not the exporter.
 */

const marked = (marks: Array<{ name: string; attrs: Record<string, unknown> }>) =>
  recordDrawOps(() =>
    buildPdf(onePage([block("paragraph", [textLine("Marked", { marks })])]), exportEditor),
  );

/** Moves a rect drawn straight after text to straight before it. */
function flipPaintPhase(ops: DrawOp[]): DrawOp[] {
  const out = [...ops];
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.op === "rect" && out[i - 1]!.op === "text") {
      [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
      return out;
    }
  }
  throw new Error("fixture drew no rect after text — nothing to flip");
}

/** Reverses a run of consecutive decoration lines. */
function reverseDecorations(ops: DrawOp[]): DrawOp[] {
  const out = [...ops];
  const first = out.findIndex((op) => op.op === "line");
  if (first < 0) throw new Error("fixture drew no lines — nothing to reorder");
  let last = first;
  while (last + 1 < out.length && out[last + 1]!.op === "line") last++;
  if (last === first) throw new Error("fixture drew one line — nothing to reorder");
  const run = out.slice(first, last + 1).reverse();
  out.splice(first, run.length, ...run);
  return out;
}

const withoutOpacity = (ops: DrawOp[]): DrawOp[] =>
  ops.map(({ opacity: _opacity, ...rest }) => rest as DrawOp);

const shiftedBy = (ops: DrawOp[], dx: number): DrawOp[] =>
  ops.map((op) => (typeof op["x"] === "number" ? { ...op, x: op["x"] + dx } : op));

const recoloured = (ops: DrawOp[]): DrawOp[] =>
  ops.map((op) => (op["color"] === undefined ? op : { ...op, color: "rgb(0.5, 0.5, 0.5)" }));

describe("the op log notices what a migration could break", () => {
  it("a highlight moved before the text it covers", async () => {
    const ops = await marked([{ name: "highlight", attrs: { color: "#fef08a" } }]);
    expect(flipPaintPhase(ops)).not.toEqual(ops);
  });

  it("a reordered decoration pair", async () => {
    // Underline and strikethrough, because they sit at different heights.
    // A link's underline and a plain underline draw the *same* line twice
    // (a linked span's text colour is already the link colour), so reordering
    // those two is genuinely unobservable — the count is what matters there.
    const ops = await marked([
      { name: "underline", attrs: {} },
      { name: "strikethrough", attrs: {} },
    ]);
    expect(reverseDecorations(ops)).not.toEqual(ops);
  });

  it("a dropped decoration, where two draws coincide exactly", async () => {
    const ops = await marked([
      { name: "link", attrs: { href: "https://example.com" } },
      { name: "underline", attrs: {} },
    ]);
    const lines = ops.filter((op) => op.op === "line");
    expect(lines).toHaveLength(2);
    // The two are identical draws, so only the count distinguishes them —
    // which is exactly why the log records every call rather than a set.
    expect(lines[0]).toEqual(lines[1]);
    expect(ops.filter((op, index) => op.op !== "line" || index === ops.indexOf(lines[0]!))).not.toEqual(ops);
  });

  it("a dropped opacity", async () => {
    const ops = await marked([{ name: "highlight", attrs: { color: "#fef08a" } }]);
    expect(ops.some((op) => op["opacity"] !== undefined)).toBe(true);
    expect(withoutOpacity(ops)).not.toEqual(ops);
  });

  it("a coordinate shift too small to see in a rounded byte diff", async () => {
    const ops = await marked([]);
    expect(shiftedBy(ops, 0.01)).not.toEqual(ops);
  });

  it("a changed colour", async () => {
    const ops = await marked([{ name: "color", attrs: { color: "#dc2626" } }]);
    expect(recoloured(ops)).not.toEqual(ops);
  });
});

describe("the op log ignores what should not matter", () => {
  it("is stable across identical exports", async () => {
    const first = await marked([{ name: "highlight", attrs: { color: "#fef08a" } }]);
    const second = await marked([{ name: "highlight", attrs: { color: "#fef08a" } }]);
    expect(second).toEqual(first);
  });

  // Asserted on the normaliser directly: a transform applied to an
  // already-recorded log would bypass it and prove nothing.
  it("rounds away arithmetic noise below what a reader could see", () => {
    expect(normalizeDrawNumber(41.9999999998)).toBe(42);
    expect(normalizeDrawNumber(42.000000001)).toBe(42);
    expect(normalizeDrawNumber(-0)).toBe(0);
    expect(normalizeDrawNumber(526.5004)).toBe(526.5);
  });

  it("keeps a difference a reader could see", () => {
    expect(normalizeDrawNumber(526.5)).not.toBe(normalizeDrawNumber(526.51));
  });
});
