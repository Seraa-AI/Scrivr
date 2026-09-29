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
import { diffText, pairReplacements } from "./diffText";

const CLAUSE = "Neither party shall be liable for any indirect loss.";

describe("proposedOffset", () => {
  it("points at the text the op was built from", () => {
    const proposed = "beta delta epsilon";
    for (const op of diffText("alpha beta gamma delta", proposed)) {
      if (op.type === "delete") {
        expect(op.proposedOffset).toBeUndefined();
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
    expect(ops[1]!.proposedOffset).toBe(0);
  });
});
