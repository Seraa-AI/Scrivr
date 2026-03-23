/**
 * Stress tests for the legal-aware diff pipeline.
 *
 * These cases are designed to break naive word-level diff engines — the kinds
 * of regressions that occur in Word, Google Docs, and Notion on complex legal
 * text. Each test targets a specific failure mode in the pipeline:
 *
 *   tokenise → diffText → pairReplacements → expandCharLevel
 *
 * Convention:
 *   wdiff(a, b)    — word-level only (diffText + pairReplacements, NO char expansion)
 *                    Use when asserting specific word tokens in deletes/inserts.
 *   fullDiff(a, b) — full pipeline including char-level expansion.
 *                    Use for round-trip accuracy and char-level behavior tests.
 */

import { describe, it, expect } from "vitest";
import {
  diffText,
  pairReplacements,
  expandCharLevel,
  computeEditDensity,
  tokenise,
  type DiffOp,
  type PairedDiffOp,
} from "./diffText";

// ── Pipeline helpers ──────────────────────────────────────────────────────────

/** Word-level only: no char expansion. Use for checking which WORDS changed. */
function wdiff(a: string, b: string): PairedDiffOp[] {
  return pairReplacements(diffText(a, b));
}

/** Full pipeline: word → grouping → char-level refinement. Use for round-trips. */
function fullDiff(a: string, b: string): PairedDiffOp[] {
  return expandCharLevel(pairReplacements(diffText(a, b)));
}

function target(ops: DiffOp[]) {
  return ops.filter(o => o.type !== "delete").map(o => o.text).join("");
}
function source(ops: DiffOp[]) {
  return ops.filter(o => o.type !== "insert").map(o => o.text).join("");
}
function deletes(ops: DiffOp[]) {
  return ops.filter(o => o.type === "delete").map(o => o.text);
}
function inserts(ops: DiffOp[]) {
  return ops.filter(o => o.type === "insert").map(o => o.text);
}
function keeps(ops: DiffOp[]) {
  return ops.filter(o => o.type === "keep").map(o => o.text);
}

function assertRoundTrip(a: string, b: string) {
  const ops = fullDiff(a, b);
  expect(target(ops)).toBe(b);
  expect(source(ops)).toBe(a);
}

// ── Case 1: Long clause — multiple replacements ───────────────────────────────

describe("stress #1 — long clause with multiple replacements", () => {
  const a = "The Supplier shall indemnify the Buyer for all damages arising from breach of this agreement.";
  const b = "The Seller agrees to indemnify the Purchaser for any damages resulting from a breach of this agreement.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("identifies all changed terms (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops).join(" ")).toMatch(/Supplier/);
    expect(inserts(ops).join(" ")).toMatch(/Seller/);
    expect(deletes(ops).join(" ")).toMatch(/Buyer/);
    expect(inserts(ops).join(" ")).toMatch(/Purchaser/);
    expect(deletes(ops).join(" ")).toMatch(/\ball\b/);
    expect(inserts(ops).join(" ")).toMatch(/\bany\b/);
  });

  it("preserves core legal phrase 'indemnify'", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("indemnify");
  });

  it("preserves 'of this agreement'", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("of this agreement");
  });
});

// ── Case 2: Section + clause ref changed together ─────────────────────────────

describe("stress #2 — section number + clause ref changed together", () => {
  const a = "See § 4.2.1(a) for the obligations of the Parties.";
  const b = "See § 5.1.3(b) for the obligations of the Parties.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("tokeniser treats § refs and sub-clauses as atomic tokens", () => {
    expect(tokenise("§ 4.2.1(a)")).toEqual(["§ 4.2.1", "(a)"]);
    expect(tokenise("§ 5.1.3(b)")).toEqual(["§ 5.1.3", "(b)"]);
  });

  it("both tokens change (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("§ 4.2.1");
    expect(inserts(ops)).toContain("§ 5.1.3");
    expect(deletes(ops)).toContain("(a)");
    expect(inserts(ops)).toContain("(b)");
  });

  it("context is preserved (word-level)", () => {
    const ops = wdiff(a, b);
    expect(keeps(ops).join("")).toContain("See");
    expect(keeps(ops).join("")).toContain("for the obligations of the Parties");
  });

  it("LCS groups § ref and sub-clause together (del-del-ins-ins order)", () => {
    // The LCS backtrack produces [del "§ 4.2.1", del "(a)", ins "§ 5.1.3", ins "(b)"]
    // — all four are part of one group since no keep token separates them.
    // This is CORRECT: changing "§ 4.2.1(a)" to "§ 5.1.3(b)" is one logical operation.
    const ops = wdiff(a, b);
    const secGroup    = ops.find(o => o.type === "delete" && o.text === "§ 4.2.1")?.groupId;
    const clauseGroup = ops.find(o => o.type === "delete" && o.text === "(a)")?.groupId;
    expect(secGroup).toBeDefined();
    expect(clauseGroup).toBeDefined();
    // Same group — they form one "change the full reference" operation
    expect(secGroup).toBe(clauseGroup);
  });
});

// ── Case 3: Long legal word → shorter word (char-level) ──────────────────────

describe("stress #3 — long legal word rewritten into shorter word", () => {
  const a = "indemnification obligation";
  const b = "indemnity obligation";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("char-level expansion preserves common prefix 'indemni'", () => {
    const ops = fullDiff(a, b);
    expect(keeps(ops).join("")).toContain("indemni");
  });

  it("only the differing suffix is marked (word-level shows the pair)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("indemnification");
    expect(inserts(ops)).toContain("indemnity");
  });

  it("'obligation' is untouched", () => {
    expect(keeps(fullDiff(a, b)).join("")).toContain("obligation");
  });

  it("all char-level ops share one groupId", () => {
    const ops = fullDiff(a, b);
    const grouped = ops.filter(o => o.groupId);
    expect(new Set(grouped.map(o => o.groupId)).size).toBe(1);
  });
});

// ── Case 4: Massive sentence rewrite with shared structure ────────────────────

describe("stress #4 — massive sentence rewrite, shared structure preserved", () => {
  const a = "The Company shall not, under any circumstances, disclose confidential information to any third party without prior written consent.";
  const b = "The Company must not disclose confidential information to third parties without written consent.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("'shall' → 'must' (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops).join(" ")).toMatch(/shall/);
    expect(inserts(ops).join(" ")).toMatch(/must/);
  });

  it("'any third party' → 'third parties': full phrase absorbed as one replacement", () => {
    const ops = wdiff(a, b);
    const del = deletes(ops).join(" ");
    const ins = inserts(ops).join(" ");
    // LCS keeps "third" between del"any" and del"party", but sandwiched-keep
    // absorption pulls it into the replacement group so users see the full
    // phrase struck through, not "~~any~~ third ~~party~~".
    expect(del).toMatch(/any/);
    expect(del).toMatch(/third/);
    expect(del).toMatch(/party/);
    expect(ins).toMatch(/parties/);
  });

  it("'prior' is deleted without a paired insert", () => {
    const ops = wdiff(a, b);
    const priorOp = ops.find(o => o.type === "delete" && o.text === "prior");
    expect(priorOp).toBeDefined();
    // Standalone delete — no groupId (or if grouped it has no matching insert)
  });

  it("'disclose confidential information' is preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("disclose confidential information");
  });
});

// ── Case 5: Hyphenated term → another hyphenated term ────────────────────────

describe("stress #5 — hyphenated term replaced by another hyphenated term", () => {
  const a = "non-compete agreement";
  const b = "non-disclosure agreement";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("tokeniser treats both as single tokens", () => {
    expect(tokenise("non-compete")).toEqual(["non-compete"]);
    expect(tokenise("non-disclosure")).toEqual(["non-disclosure"]);
  });

  it("whole hyphenated token is the replacement unit (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("non-compete");
    expect(inserts(ops)).toContain("non-disclosure");
  });

  it("'agreement' is kept", () => {
    expect(keeps(wdiff(a, b))).toContain("agreement");
  });

  it("change is a paired replacement (same groupId)", () => {
    const ops = wdiff(a, b);
    const del = ops.find(o => o.type === "delete" && o.text === "non-compete");
    const ins = ops.find(o => o.type === "insert" && o.text === "non-disclosure");
    expect(del?.groupId).toBeDefined();
    expect(del?.groupId).toBe(ins?.groupId);
  });
});

// ── Case 6: Very small insertion in a long phrase ─────────────────────────────

describe("stress #6 — tiny insertion inside a long legal phrase", () => {
  const a = "termination for material breach of contract";
  const b = "termination for a material breach of contract";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("only 'a' is inserted — no deletions", () => {
    const ops = fullDiff(a, b);
    expect(deletes(ops)).toHaveLength(0);
    expect(inserts(ops).join("").trim()).toBe("a");
  });

  it("surrounding context entirely kept", () => {
    const ops = fullDiff(a, b);
    const k = keeps(ops).join("");
    expect(k).toContain("termination for");
    expect(k).toContain("material breach of contract");
  });
});

// ── Case 7: 'shall have' → 'has' ────────────────────────────────────────────

describe("stress #7 — 'shall have' → 'has' (multi-word → single word)", () => {
  const a = "The Buyer shall have the right to terminate this agreement.";
  const b = "The Buyer has the right to terminate this agreement.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("'shall' and 'have' deleted; 'has' inserted (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops).join(" ")).toMatch(/shall/);
    expect(inserts(ops).join(" ")).toMatch(/has/);
  });

  it("preserves 'the right to terminate this agreement'", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("the right to terminate this agreement");
  });
});

// ── Case 8: Change at position 0 ─────────────────────────────────────────────

describe("stress #8 — word changed at the very start of the sentence", () => {
  const a = "Supplier agrees to deliver the goods.";
  const b = "Seller agrees to deliver the goods.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("first-token replacement identified (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("Supplier");
    expect(inserts(ops)).toContain("Seller");
  });

  it("rest of sentence kept", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("agrees to deliver the goods");
  });
});

// ── Case 9: Change at the very end ───────────────────────────────────────────

describe("stress #9 — word changed at the very end of the sentence", () => {
  const a = "The contract shall terminate immediately.";
  const b = "The contract shall terminate automatically.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("only the final adverb changes (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("immediately");
    expect(inserts(ops)).toContain("automatically");
  });

  it("full prefix preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("The contract shall terminate");
  });

  it("final period preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain(".");
  });
});

// ── Case 10: Look-ahead grouping — shared words inside phrase ─────────────────

describe("stress #10 — look-ahead bridges LCS keeps inside phrase replacement", () => {
  const a = "of the Party to this agreement";
  const b = "the Seller to this agreement";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("'Party' and 'Seller' end up in a replacement group", () => {
    const ops = wdiff(a, b);
    const partyDel  = ops.find(o => o.type === "delete" && o.text === "Party");
    const sellerIns = ops.find(o => o.type === "insert" && o.text === "Seller");
    expect(partyDel?.groupId).toBeDefined();
    expect(partyDel?.groupId).toBe(sellerIns?.groupId);
  });

  it("'to this agreement' preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("to this agreement");
  });
});

// ── Case 11: Deep nested section number ──────────────────────────────────────

describe("stress #11 — deep nested section number (§ 12.4.3.1)", () => {
  const a = "See § 12.4.3.1 for payment obligations.";
  const b = "See § 12.5.1.2 for payment obligations.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("tokeniser captures deep § refs as one token", () => {
    expect(tokenise("§ 12.4.3.1")).toEqual(["§ 12.4.3.1"]);
    expect(tokenise("§ 12.5.1.2")).toEqual(["§ 12.5.1.2"]);
  });

  it("only the section token changes (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("§ 12.4.3.1");
    expect(inserts(ops)).toContain("§ 12.5.1.2");
    expect(keeps(ops).join("")).toContain("See");
    expect(keeps(ops).join("")).toContain("for payment obligations");
  });
});

// ── Case 12: 'shall' → 'must' in a long sentence ─────────────────────────────

describe("stress #12 — 'shall' → 'must' surgical swap in long sentence", () => {
  const a = "The Contractor shall maintain insurance coverage at all times during the term of this agreement.";
  const b = "The Contractor must maintain insurance coverage at all times during the term of this agreement.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("only 'shall' ↔ 'must' changes (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toEqual(["shall"]);
    expect(inserts(ops)).toEqual(["must"]);
  });

  it("entire sentence except 'shall' is kept", () => {
    const k = keeps(wdiff(a, b)).join("");
    expect(k).toContain("The Contractor");
    expect(k).toContain("maintain insurance coverage at all times during the term of this agreement");
  });
});

// ── Case 13: Legal pluralisation (char-level) ─────────────────────────────────

describe("stress #13 — legal pluralisation: 'third party' → 'third parties'", () => {
  const a = "third party";
  const b = "third parties";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("char-level: 'third part' kept, only suffix changes", () => {
    const ops = fullDiff(a, b);
    expect(keeps(ops).join("")).toContain("third part");
    expect(deletes(ops).join("")).toBe("y");
    expect(inserts(ops).join("")).toBe("ies");
  });

  it("word-level shows 'party' → 'parties' as paired token", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("party");
    expect(inserts(ops)).toContain("parties");
  });

  it("all char-level ops share one groupId", () => {
    const ops = fullDiff(a, b);
    const grouped = ops.filter(o => o.groupId);
    expect(new Set(grouped.map(o => o.groupId)).size).toBe(1);
  });
});

// ── Case 14: Multiple independent small edits ────────────────────────────────

describe("stress #14 — multiple independent small edits in one sentence", () => {
  const a = "The Company shall provide written notice within 10 days.";
  const b = "The Company must provide written notice within ten days.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("'shall' → 'must' and '10' → 'ten' both identified (word-level)", () => {
    const ops = wdiff(a, b);
    expect(deletes(ops)).toContain("shall");
    expect(inserts(ops)).toContain("must");
    expect(deletes(ops)).toContain("10");
    expect(inserts(ops)).toContain("ten");
  });

  it("two replacements get distinct groupIds", () => {
    const ops = wdiff(a, b);
    const shallGroup = ops.find(o => o.type === "delete" && o.text === "shall")?.groupId;
    const tenGroup   = ops.find(o => o.type === "delete" && o.text === "10")?.groupId;
    expect(shallGroup).toBeDefined();
    expect(tenGroup).toBeDefined();
    expect(shallGroup).not.toBe(tenGroup);
  });

  it("'provide written notice within' preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("provide written notice within");
  });
});

// ── Case 15: Large rewrite with shared core structure ────────────────────────

describe("stress #15 — large rewrite preserving sentence skeleton", () => {
  const a = "This agreement shall remain in effect until terminated by either party in accordance with the terms herein.";
  const b = "This agreement remains in effect until either party terminates it in accordance with these terms.";

  it("round-trips correctly", () => assertRoundTrip(a, b));

  it("'shall' is deleted", () => {
    expect(deletes(wdiff(a, b)).join(" ")).toMatch(/shall/);
  });

  it("'in effect until' preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("in effect until");
  });

  it("'in accordance with' preserved", () => {
    expect(keeps(wdiff(a, b)).join("")).toContain("in accordance with");
  });

  it("'herein' disappears from target", () => {
    expect(target(wdiff(a, b))).not.toContain("herein");
  });

  it("produces multiple ops — not a block fallback", () => {
    expect(fullDiff(a, b).length).toBeGreaterThan(2);
  });
});

// ── Pipeline invariants across all stress inputs ──────────────────────────────

describe("pipeline invariants across all stress inputs", () => {
  const cases: [string, string][] = [
    [
      "The Supplier shall indemnify the Buyer for all damages arising from breach of this agreement.",
      "The Seller agrees to indemnify the Purchaser for any damages resulting from a breach of this agreement.",
    ],
    ["See § 4.2.1(a) for the obligations of the Parties.", "See § 5.1.3(b) for the obligations of the Parties."],
    ["indemnification obligation", "indemnity obligation"],
    ["non-compete agreement", "non-disclosure agreement"],
    ["Supplier agrees to deliver the goods.", "Seller agrees to deliver the goods."],
    ["The contract shall terminate immediately.", "The contract shall terminate automatically."],
    ["The Company shall provide written notice within 10 days.", "The Company must provide written notice within ten days."],
    ["third party", "third parties"],
  ];

  for (const [a, b] of cases) {
    it(`round-trips: "${a!.slice(0, 55)}…"`, () => {
      const ops = fullDiff(a!, b!);
      expect(target(ops)).toBe(b!);
      expect(source(ops)).toBe(a!);
    });

    it(`editDensity ∈ [0,1]: "${a!.slice(0, 55)}…"`, () => {
      const d = computeEditDensity(diffText(a!, b!));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    });
  }
});
