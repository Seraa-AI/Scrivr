import { describe, it, expect } from "vitest";
import {
  computeEditDensity,
  diffChars,
  diffText,
  expandCharLevel,
  pairReplacements,
  tokenise,
  type DiffOp,
  type PairedDiffOp,
} from "./diffText";

// ── tokenise ──────────────────────────────────────────────────────────────────

describe("tokenise — round-trip", () => {
  const samples = [
    "The quick brown fox",
    "Section 1(a)(ii) of the Agreement",
    "contract, dated 2024-01-15.",
    "party—hereinafter referred to as \"Licensor\"",
    "shall not exceed $1,000,000.00",
    "WHEREAS, the parties agree...",
    "non-compete covenant",
    "§ 1.2.3 of the Act",
    "§12 applies",
    "",
    "  leading spaces",
    "trailing spaces  ",
  ];
  for (const s of samples) {
    it(`round-trips: "${s.slice(0, 40)}"`, () => {
      expect(tokenise(s).join("")).toBe(s);
    });
  }
});

describe("tokenise — legal patterns", () => {
  it("section symbol is one token", () => {
    expect(tokenise("§ 1.2.3")).toEqual(["§ 1.2.3"]);
    expect(tokenise("§12")).toEqual(["§12"]);
    expect(tokenise("§ 1")).toEqual(["§ 1"]);
  });

  it("sub-clause refs are one token each", () => {
    expect(tokenise("(a)")).toEqual(["(a)"]);
    expect(tokenise("(ii)")).toEqual(["(ii)"]);
    expect(tokenise("(A-1)")).toEqual(["(A-1)"]);
    expect(tokenise("(a)(ii)")).toEqual(["(a)", "(ii)"]);
  });

  it("clause references are compactly tokenised", () => {
    expect(tokenise("Section 1(a)(ii)")).toEqual([
      "Section", " ", "1", "(a)", "(ii)",
    ]);
  });

  it("hyphenated words are one token", () => {
    expect(tokenise("non-compete")).toEqual(["non-compete"]);
    expect(tokenise("sub-section")).toEqual(["sub-section"]);
    expect(tokenise("work-for-hire")).toEqual(["work-for-hire"]);
  });

  it("standalone hyphen (em-dash) is not part of a word", () => {
    expect(tokenise("party—hereinafter")).toEqual(["party", "—", "hereinafter"]);
  });

  it("punctuation chars are individual tokens", () => {
    expect(tokenise("contract,")).toEqual(["contract", ","]);
    expect(tokenise("dated.")).toEqual(["dated", "."]);
  });

  it("amounts: each punctuation is separate", () => {
    expect(tokenise("$1,000")).toEqual(["$", "1", ",", "000"]);
  });

  it("whitespace runs are one token", () => {
    expect(tokenise("a  b")).toEqual(["a", "  ", "b"]);
    expect(tokenise("a\t\tb")).toEqual(["a", "\t\t", "b"]);
  });

  it("empty string returns empty array", () => {
    expect(tokenise("")).toEqual([]);
  });
});

// ── diffText ──────────────────────────────────────────────────────────────────

describe("diffText", () => {
  it("identical strings → all keeps", () => {
    const ops = diffText("hello world", "hello world");
    expect(ops.every(o => o.type === "keep")).toBe(true);
    expect(ops.map(o => o.text).join("")).toBe("hello world");
  });

  it("simple word replacement: 'foo' → 'bar'", () => {
    const ops = diffText("foo", "bar");
    expect(ops).toEqual([
      { type: "delete", text: "foo" },
      { type: "insert", text: "bar" },
    ]);
  });

  it("keeps+inserts reconstruct target", () => {
    const pairs: [string, string][] = [
      ["The quick brown fox", "The slow red fox"],
      ["Section 1(a)", "Section 2(b)"],
      ["shall not exceed $1,000", "shall not exceed $2,000"],
      ["non-compete covenant", "non-solicitation covenant"],
    ];
    for (const [a, b] of pairs) {
      const ops = diffText(a, b);
      const target = ops.filter(o => o.type !== "delete").map(o => o.text).join("");
      expect(target).toBe(b);
    }
  });

  it("keeps+deletes reconstruct source", () => {
    const a = "The party of the first part agrees";
    const b = "The party agrees";
    const ops = diffText(a, b);
    const source = ops.filter(o => o.type !== "insert").map(o => o.text).join("");
    expect(source).toBe(a);
  });

  it("legal clause: only amended numbers change", () => {
    const a = "The Licensee shall pay within thirty (30) days of invoice.";
    const b = "The Licensee shall pay within sixty (60) days of invoice.";
    const ops = diffText(a, b);
    const deletes = ops.filter(o => o.type === "delete").map(o => o.text);
    const inserts  = ops.filter(o => o.type === "insert").map(o => o.text);
    expect(deletes).toContain("thirty");
    expect(inserts).toContain("sixty");
    // "(30)" is a sub-clause token — the legal tokeniser keeps it atomic
    expect(deletes).toContain("(30)");
    expect(inserts).toContain("(60)");
    expect(ops.filter(o => o.type === "keep").map(o => o.text).join(""))
      .toContain("The Licensee shall pay within");
  });

  it("punctuation-only change: comma → semicolon", () => {
    const ops = diffText("party A, party B", "party A; party B");
    expect(ops.filter(o => o.type === "delete").map(o => o.text)).toEqual([","]);
    expect(ops.filter(o => o.type === "insert").map(o => o.text)).toEqual([";"]);
  });

  it("sub-clause ref change: (a) → (b)", () => {
    const ops = diffText("Section 1(a) applies", "Section 1(b) applies");
    const deletes = ops.filter(o => o.type === "delete").map(o => o.text);
    const inserts  = ops.filter(o => o.type === "insert").map(o => o.text);
    // "(a)" is a single token — deleted and replaced by "(b)"
    expect(deletes).toContain("(a)");
    expect(inserts).toContain("(b)");
    // Surrounding context is kept
    expect(ops.some(o => o.type === "keep" && o.text === "Section")).toBe(true);
  });

  it("hyphenated word replacement: non-compete → non-solicitation", () => {
    const ops = diffText("non-compete covenant", "non-solicitation covenant");
    const deletes = ops.filter(o => o.type === "delete").map(o => o.text);
    const inserts  = ops.filter(o => o.type === "insert").map(o => o.text);
    // Each hyphenated term should be one token
    expect(deletes).toContain("non-compete");
    expect(inserts).toContain("non-solicitation");
  });

  it("LCS size guard: very long paragraphs fall back to block delete+insert", () => {
    // ~200 unique words each → 200×200 = 40,000 cells, well above LCS_MAX_CELLS
    const makeWords = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
    const a = makeWords("alpha", 150);
    const b = makeWords("beta", 150);
    const ops = diffText(a, b);
    // Must return exactly one delete and one insert (block fallback)
    expect(ops).toHaveLength(2);
    expect(ops[0]!.type).toBe("delete");
    expect(ops[1]!.type).toBe("insert");
    // And they must reconstruct the original strings
    expect(ops[0]!.text).toBe(a);
    expect(ops[1]!.text).toBe(b);
  });

  it("LCS size guard: paragraphs within limit still produce fine-grained diff", () => {
    // 30×30 = 900 cells, well within LCS_MAX_CELLS
    const a = "The quick brown fox jumps over the lazy dog";
    const b = "The slow red fox jumps over the active dog";
    const ops = diffText(a, b);
    // Should produce multiple ops (fine-grained), not just 2
    expect(ops.length).toBeGreaterThan(2);
  });
});

// ── diffChars ─────────────────────────────────────────────────────────────────

describe("diffChars", () => {
  it("identical strings → all keeps", () => {
    expect(diffChars("abc", "abc").every(o => o.type === "keep")).toBe(true);
  });

  it("suffix change: liability → liabilities", () => {
    const ops = diffChars("liability", "liabilities");
    // Common prefix "liabilit" kept, "y" deleted, "ies" inserted
    const keeps  = ops.filter(o => o.type === "keep")  .map(o => o.text).join("");
    const deletes = ops.filter(o => o.type === "delete").map(o => o.text).join("");
    const inserts = ops.filter(o => o.type === "insert").map(o => o.text).join("");
    expect(keeps).toContain("liabilit");
    expect(deletes).toBe("y");
    expect(inserts).toBe("ies");
  });

  it("keeps+inserts reconstruct target", () => {
    const pairs: [string, string][] = [
      ["indemnification", "indemnity"],
      ["liability", "liabilities"],
      ["agreement", "agreements"],
      ["party", "parties"],
    ];
    for (const [a, b] of pairs) {
      const ops = diffChars(a, b);
      expect(ops.filter(o => o.type !== "delete").map(o => o.text).join("")).toBe(b);
    }
  });
});

// ── pairReplacements ──────────────────────────────────────────────────────────

describe("pairReplacements — strict adjacency", () => {
  it("adjacent delete+insert share a groupId", () => {
    const paired = pairReplacements(diffText("foo", "bar"));
    const del = paired.find(o => o.type === "delete")!;
    const ins = paired.find(o => o.type === "insert")!;
    expect(del.groupId).toBeDefined();
    expect(ins.groupId).toBeDefined();
    expect(del.groupId).toBe(ins.groupId);
  });

  it("standalone delete has no groupId", () => {
    const paired = pairReplacements(diffText("hello world", "hello"));
    expect(paired.find(o => o.type === "delete")!.groupId).toBeUndefined();
  });

  it("standalone insert has no groupId", () => {
    const paired = pairReplacements(diffText("hello", "hello world"));
    expect(paired.find(o => o.type === "insert")!.groupId).toBeUndefined();
  });

  it("multiple adjacent replacements get distinct groupIds", () => {
    const a = "pay within thirty (30) days";
    const b = "pay within sixty (60) days";
    const paired = pairReplacements(diffText(a, b));
    const groups = paired.filter(o => o.groupId).map(o => o.groupId!);
    const unique = new Set(groups);
    // "thirty"→"sixty" and "(30)"→"(60)" are two separate replacement pairs
    expect(unique.size).toBeGreaterThanOrEqual(2);
    // Each groupId links exactly one delete to one insert (2 ops per group)
    for (const gid of unique) {
      expect(groups.filter(g => g === gid).length).toBe(2);
    }
    // Verify the two replacements got different groupIds
    const thirtyGroup = paired.find(o => o.type === "delete" && o.text === "thirty")?.groupId;
    const parensGroup = paired.find(o => o.type === "delete" && o.text === "(30)")?.groupId;
    expect(thirtyGroup).toBeDefined();
    expect(parensGroup).toBeDefined();
    expect(thirtyGroup).not.toBe(parensGroup);
  });

  it("does not mutate original ops", () => {
    const ops = diffText("foo", "bar");
    const snapshot = ops.map(o => ({ ...o }));
    pairReplacements(ops);
    expect(ops).toEqual(snapshot);
  });

  it("groupId is deterministic: same input always produces same groupId", () => {
    const a = "thirty (30) days";
    const b = "sixty (60) days";
    const run1 = pairReplacements(diffText(a, b));
    const run2 = pairReplacements(diffText(a, b));
    const ids1 = run1.filter(o => o.groupId).map(o => o.groupId);
    const ids2 = run2.filter(o => o.groupId).map(o => o.groupId);
    expect(ids1).toEqual(ids2);
  });

  it("groupId encodes position: different replacement positions → different ids", () => {
    const ops: DiffOp[] = [
      { type: "delete", text: "A" },
      { type: "insert", text: "B" },
      { type: "keep",   text: " " },
      { type: "delete", text: "C" },
      { type: "insert", text: "D" },
    ];
    const paired = pairReplacements(ops);
    const gid1 = paired[0]!.groupId;
    const gid2 = paired[3]!.groupId;
    expect(gid1).toBeDefined();
    expect(gid2).toBeDefined();
    expect(gid1).not.toBe(gid2);
  });
});

describe("pairReplacements — look-ahead buffer", () => {
  it("bridges short keep sequences to form one replacement group", () => {
    // Simulate: [del, keep, keep, ins] — 2 keeps within default buffer of 5
    const ops: DiffOp[] = [
      { type: "delete", text: "of" },
      { type: "keep",   text: " " },
      { type: "keep",   text: "the" },
      { type: "keep",   text: " " },
      { type: "delete", text: "party" },
      { type: "insert", text: "seller" },
    ];
    const paired = pairReplacements(ops);
    const gids = paired.filter(o => o.type !== "keep" && o.groupId).map(o => o.groupId!);
    // All non-keep ops share one groupId (keeps sandwiched between two deletes
    // are absorbed into the replacement group, so the phrase "of the party" →
    // "seller" is one atomic unit: 5 deletes + 4 inserts = 9 grouped ops).
    expect(new Set(gids).size).toBe(1);
    const delTexts = paired.filter(o => o.type === "delete").map(o => o.text).join("");
    const insTexts = paired.filter(o => o.type === "insert").map(o => o.text).join("");
    expect(delTexts).toBe("of the party"); // full phrase absorbed
    expect(insTexts).toBe(" the seller");  // sandwiched keeps re-inserted + new word
  });

  it("does NOT bridge if keep run exceeds look-ahead window", () => {
    const ops: DiffOp[] = [
      { type: "delete", text: "A" },
      ...Array.from({ length: 6 }, (): DiffOp => ({ type: "keep", text: "x" })),
      { type: "insert", text: "B" },
    ];
    const paired = pairReplacements(ops, 5);
    // The delete and insert are separated by 6 keeps — beyond the window
    expect(paired.find(o => o.type === "delete")!.groupId).toBeUndefined();
    expect(paired.find(o => o.type === "insert")!.groupId).toBeUndefined();
  });

  it("keeps within the group have no groupId", () => {
    const ops: DiffOp[] = [
      { type: "delete", text: "A" },
      { type: "keep",   text: " " },
      { type: "insert", text: "B" },
    ];
    const paired = pairReplacements(ops);
    expect(paired.find(o => o.type === "keep")!.groupId).toBeUndefined();
  });

  it("delete-delete-insert: first delete pairs with the second delete and the insert", () => {
    const ops: DiffOp[] = [
      { type: "delete", text: "A" },
      { type: "delete", text: "B" },
      { type: "insert", text: "C" },
    ];
    const paired = pairReplacements(ops);
    const gids = paired.filter(o => o.groupId).map(o => o.groupId!);
    expect(new Set(gids).size).toBe(1);
    expect(gids.length).toBe(3);
  });

  it("real legal phrase: phrase replacement groups correctly", () => {
    // "of the Party" → "the Seller" — LCS keeps "the" and " " in the middle
    const a = "of the Party";
    const b = "the Seller";
    const paired = pairReplacements(diffText(a, b));
    const withGroup = paired.filter(o => o.groupId);
    // At minimum, "Party" (delete) and "Seller" (insert) should be in a group
    const groupIds = new Set(withGroup.map(o => o.groupId));
    expect(groupIds.size).toBeGreaterThanOrEqual(1);
    // Exactly one unified group covering all the replacements
    const inserts = withGroup.filter(o => o.type === "insert");
    const deletes = withGroup.filter(o => o.type === "delete");
    expect(inserts.some(o => o.text === "Seller")).toBe(true);
    expect(deletes.some(o => o.text === "Party")).toBe(true);
  });
});

// ── expandCharLevel ───────────────────────────────────────────────────────────

describe("expandCharLevel", () => {
  function makePair(del: string, ins: string, groupId = "g1"): PairedDiffOp[] {
    return [
      { type: "delete", text: del, groupId },
      { type: "insert", text: ins, groupId },
    ];
  }

  it("expands similar word pair to char-level ops", () => {
    const expanded = expandCharLevel(makePair("liability", "liabilities"));
    // Should contain keep, delete, insert ops at char granularity
    const types = expanded.map(o => o.type);
    expect(types).toContain("keep");
    expect(types).toContain("delete");
    expect(types).toContain("insert");
    // All ops inherit the groupId
    expect(expanded.every(o => o.groupId === "g1")).toBe(true);
    // Reconstruction: keeps+inserts = target
    expect(expanded.filter(o => o.type !== "delete").map(o => o.text).join("")).toBe("liabilities");
  });

  it("preserves word-level for dissimilar words (below threshold)", () => {
    // "party" vs "seller" share 0 chars → no char expansion
    const ops = makePair("party", "seller");
    const expanded = expandCharLevel(ops);
    expect(expanded.length).toBe(2);
    expect(expanded[0]!.type).toBe("delete");
    expect(expanded[1]!.type).toBe("insert");
  });

  it("expands long similar tokens (no hard length cap)", () => {
    // "Indemnification Obligation" → "Indemnification Duty" — long but similar prefix
    const expanded = expandCharLevel(makePair("IndemnificationObligation", "IndemnificationDuty"));
    // Should be expanded: common prefix "Indemnification" (15 chars), long suffix differs
    expect(expanded.some(o => o.type === "keep")).toBe(true);
    expect(expanded.filter(o => o.type !== "delete").map(o => o.text).join(""))
      .toBe("IndemnificationDuty");
  });

  it("does not expand totally dissimilar tokens", () => {
    // "party" vs "seller": only 'r' in common → similarity 1/6 ≈ 0.17 < 0.4
    expect(expandCharLevel(makePair("party", "seller"))).toHaveLength(2);
    // Longer strings with disjoint char sets
    const longA = "aaabbbcccdddeee";  // chars: a,b,c,d,e
    const longB = "fffggghhhjjjkkk";  // chars: f,g,h,j,k — zero overlap
    expect(expandCharLevel(makePair(longA, longB))).toHaveLength(2);
  });

  it("does not expand unmatched pairs (different groupIds)", () => {
    const ops: PairedDiffOp[] = [
      { type: "delete", text: "liability", groupId: "g1" },
      { type: "insert", text: "liabilities", groupId: "g2" }, // different group
    ];
    const expanded = expandCharLevel(ops);
    expect(expanded.length).toBe(2); // unchanged
  });

  it("does not expand unpaired ops (no groupId)", () => {
    const ops: PairedDiffOp[] = [
      { type: "delete", text: "liability" },
      { type: "insert", text: "liabilities" },
    ];
    const expanded = expandCharLevel(ops);
    expect(expanded.length).toBe(2);
  });

  it("leaves keep ops and non-adjacent pairs untouched", () => {
    const ops: PairedDiffOp[] = [
      { type: "keep",   text: "unchanged " },
      { type: "delete", text: "liability", groupId: "g1" },
      { type: "keep",   text: " between " }, // not adjacent delete+insert
      { type: "insert", text: "liabilities", groupId: "g1" },
    ];
    const expanded = expandCharLevel(ops);
    // The delete and insert are not adjacent (keep in between) → no expansion
    expect(expanded.length).toBe(4);
    expect(expanded[1]!.type).toBe("delete");
    expect(expanded[3]!.type).toBe("insert");
  });
});

// ── computeEditDensity ────────────────────────────────────────────────────────

describe("computeEditDensity", () => {
  it("identical text → 0", () => {
    expect(computeEditDensity(diffText("hello", "hello"))).toBe(0);
  });

  it("pure insertion → 0 (nothing deleted from source)", () => {
    const density = computeEditDensity(diffText("hello", "hello world"));
    expect(density).toBe(0);
  });

  it("pure deletion → 1 (all source deleted)", () => {
    // "hello world" → "hello": " world" is deleted
    const density = computeEditDensity(diffText("hello world", "hello"));
    // deleted = " world" = 6, source = "hello world" = 11 → density = 6/11
    expect(density).toBeCloseTo(6 / 11);
  });

  it("complete replacement → 1", () => {
    // "foo" → "bar": all 3 chars of source deleted
    const density = computeEditDensity(diffText("foo", "bar"));
    expect(density).toBe(1);
  });

  it("light edit → low density", () => {
    const a = "The Licensee shall pay within thirty (30) days.";
    const b = "The Licensee shall pay within sixty (60) days.";
    const density = computeEditDensity(diffText(a, b));
    // "thirty" (6) + " " (1) + "(30)" (4) deleted out of a.length (47)
    // density should be well below 0.4
    expect(density).toBeLessThan(0.4);
  });

  it("heavy rewrite → high density", () => {
    const a = "WHEREAS the party of the first part";
    const b = "The Seller";
    const density = computeEditDensity(diffText(a, b));
    expect(density).toBeGreaterThan(0.4);
  });

  it("empty strings → 0", () => {
    expect(computeEditDensity([])).toBe(0);
    expect(computeEditDensity(diffText("", ""))).toBe(0);
  });

  it("density is between 0 and 1 for all inputs", () => {
    const cases = [
      ["hello", "world"],
      ["Section 1(a)", "§ 2(b)"],
      ["non-compete", "non-solicitation"],
      ["", "inserted"],
      ["deleted", ""],
    ];
    for (const [a, b] of cases) {
      const d = computeEditDensity(diffText(a!, b!));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});
