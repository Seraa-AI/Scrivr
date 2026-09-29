/**
 * What a diff op knows about where it came from.
 *
 * `pairReplacements` deliberately reorders its output — all deletes, then
 * boundary keeps, then all inserts — so that a consumer applying the diff
 * processes a whole deleted range before inserting its replacement. That
 * ordering is correct for the document side and says nothing about the
 * proposal side, so a consumer that needs to know *where in the proposed text*
 * an op came from cannot recover it by counting as it walks.
 *
 * So each op that consumes proposed text carries the offset it was built from.
 */
import { describe, expect, it } from "vitest";
import { diffText, expandCharLevel, pairReplacements } from "./diffText";

const CLAUSE = "Neither party shall be liable for any indirect loss.";

describe("proposedOffset", () => {
  it("points at the text the op was built from", () => {
    const proposed = "beta delta epsilon";
    for (const op of diffText("alpha beta gamma delta", proposed)) {
      // The type says a delete has no proposal offset; this says the value
      // agrees with the type.
      if (op.type === "delete") {
        expect("proposedOffset" in op).toBe(false);
        continue;
      }
      expect(op.proposedOffset).toBeDefined();
      expect(proposed.slice(op.proposedOffset!, op.proposedOffset! + op.text.length)).toBe(op.text);
    }
  });

  it("survives the reordering pairReplacements does", () => {
    // This pairing has both a sandwiched keep (rewritten as delete+insert) and
    // a boundary keep, which is what puts the output out of proposal order.
    const proposed = "beta delta epsilon";
    for (const op of pairReplacements(diffText("alpha beta gamma delta", proposed))) {
      if (op.type === "delete") continue;
      expect(op.proposedOffset).toBeDefined();
      expect(proposed.slice(op.proposedOffset!, op.proposedOffset! + op.text.length)).toBe(op.text);
    }
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

describe("character-level expansion", () => {
  it("never reports an offset measured from the token it re-diffed", () => {
    // Expansion re-diffs one word pair, so an offset it produced would be
    // counted from that word and point into a different one. An op that still
    // carries an offset must still be telling the truth about the proposal.
    const proposed = "the indemnity clause";
    const ops = expandCharLevel(
      pairReplacements(diffText("the indemnification clause", proposed)),
    );

    let expandedOps = 0;
    for (const op of ops) {
      if (op.type === "delete") continue;
      if (!("proposedOffset" in op) || op.proposedOffset === undefined) {
        expandedOps += 1;
        continue;
      }
      expect(proposed.slice(op.proposedOffset, op.proposedOffset + op.text.length)).toBe(op.text);
    }
    // The case does expand, so the assertion above is not vacuous.
    expect(expandedOps).toBeGreaterThan(0);
  });
});
