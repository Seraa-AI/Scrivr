/**
 * What a diff op knows about where it came from.
 *
 * `pairReplacements` hoists a group's deletes ahead of the text that replaces
 * them, so a consumer applying the diff clears a whole deleted range before
 * writing into it. That is correct for the document side, and it means a
 * consumer counting proposal characters as it walks the emitted ops drifts at
 * every replacement.
 *
 * So each op that consumes proposed text carries the offset it was built from,
 * stamped where the order still is the proposal's own.
 */
import { describe, expect, it } from "vitest";
import { diffText, pairReplacements, phraseReplacements } from "./diffText";

const CLAUSE = "Neither party shall be liable for any indirect loss.";

/** The text each op that consumes proposed text was built from, read back through its offset. */
const readBack = (ops: ReturnType<typeof pairReplacements>, proposed: string) =>
  ops.flatMap((op) => {
    if (op.type === "delete") return [];
    const at = op.proposedOffset ?? -1;
    return [{ text: op.text, at: proposed.slice(at, at + op.text.length) }];
  });

describe("proposedOffset", () => {
  it("points at the text the op was built from", () => {
    const proposed = "beta delta epsilon";
    const ops = diffText("alpha beta gamma delta", proposed);
    // The type says a delete has no proposal offset; this says the value agrees.
    expect(ops.filter((op) => op.type === "delete").every((op) => !("proposedOffset" in op))).toBe(true);
    const read = readBack(ops, proposed);
    expect(read.length).toBeGreaterThan(0);
    for (const { text, at } of read) expect(at).toBe(text);
  });

  it("survives the reordering pairReplacements does", () => {
    // This pairing has both a sandwiched keep (rewritten as delete+insert) and
    // a boundary keep, which is what puts the output out of proposal order.
    const proposed = "beta delta epsilon";
    const read = readBack(pairReplacements(diffText("alpha beta gamma delta", proposed)), proposed);
    expect(read.length).toBeGreaterThan(0);
    for (const { text, at } of read) expect(at).toBe(text);
  });
});

describe("text that did not change", () => {
  it("is one keep, however long it is", () => {
    // Long enough to trip the quadratic guard, which used to answer
    // "delete everything, insert everything" for two identical strings.
    const long = CLAUSE.repeat(12);
    expect(long.length).toBeGreaterThan(450);

    const ops = diffText(long, long);
    expect(ops).toEqual([{ type: "keep", text: long, proposedOffset: 0 }]);
  });

  it("is still one keep when short", () => {
    const ops = diffText("same", "same");
    expect(ops.every((op) => op.type === "keep")).toBe(true);
    expect(ops.map((op) => op.text).join("")).toBe("same");
  });
});

describe("the quadratic guard still protects genuinely different long text", () => {
  it("falls back to a whole-block replacement", () => {
    const a = CLAUSE.repeat(12);
    const b = "Something else entirely. ".repeat(20);
    const ops = diffText(a, b);

    expect(ops.map((op) => op.type)).toEqual(["delete", "insert"]);
    const insert = ops[1];
    expect(insert?.type).toBe("insert");
    if (insert?.type !== "insert") throw new Error("expected an insert");
    expect(insert.proposedOffset).toBe(0);
  });
});

describe("phrase replacements", () => {
  it("keep their offsets on what they leave unchanged", () => {
    // A replacement joins words from across a gap, so it carries no offset of
    // its own; what it leaves kept still points at the proposal truthfully.
    const proposed = "All staff; contractors are covered.";
    const ops = phraseReplacements(diffText("All staff, contractors is covered.", proposed));
    for (const op of ops) {
      if (op.type !== "keep" || op.proposedOffset === undefined) continue;
      expect(proposed.slice(op.proposedOffset, op.proposedOffset + op.text.length)).toBe(op.text);
    }
  });
});
