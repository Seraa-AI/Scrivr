/**
 * diffText — legal-aware LCS diff with replacement grouping and char-level refinement.
 *
 * ## Tokeniser
 * The tokeniser is "greedy" for legal markers so that clause references and
 * hyphenated terms are treated as atomic units:
 *
 *   §\s*\d+(\.\d+)*      — section symbols:   "§ 1.2.3"    → one token
 *   \([A-Za-z0-9…]*\)    — sub-clauses:       "(a)", "(ii)" → one token each
 *   \w+(?:-\w+)*         — hyphenated words:  "non-compete" → one token
 *   \s+                  — whitespace runs     (preserved for round-trip)
 *   [^\s]                — catch-all: any single non-whitespace char
 *
 * Round-trip: join(tokenise(s)) === s is always true.
 *
 * ## Replacement grouping
 * pairReplacements() uses a look-ahead buffer (default 5 tokens) to bridge
 * short keep sequences inside a phrase replacement, so that
 * "of the Party" → "the Seller" is grouped as one replacement even though
 * the LCS keeps "the" and the following space.
 *
 * ## Char-level refinement
 * diffChars() re-runs the LCS at character granularity so word-level
 * replacements like "indemnification" → "indemnity" produce surgical marks
 * on only the changed suffix rather than striking the whole word.
 *
 * ## Noise filter
 * computeEditDensity() returns the fraction of original characters that were
 * deleted, giving callers a quality gate to decide whether to surface the
 * fine-grained diff or offer a simplified "replace block" view.
 *
 * No external dependencies — pure TypeScript.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiffOp =
  | { type: "keep";   text: string }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string };

/**
 * A DiffOp extended with an optional groupId.
 * All deletes and inserts that together form one logical replacement share the
 * same groupId so UI and accept/reject can treat them as a single atomic unit.
 */
export type PairedDiffOp = DiffOp & { groupId?: string };

// ── Tokeniser ─────────────────────────────────────────────────────────────────

/**
 * Legal-aware tokeniser.
 *
 * Match priority (first match wins in a global regex):
 *   1. Section symbols  §1.2 / § 12.3.4
 *   2. Sub-clause refs  (a) / (ii) / (A-1)
 *   3. Hyphenated words non-compete / sub-section / A-1
 *   4. Whitespace runs
 *   5. Any other single non-whitespace character (punctuation, brackets, etc.)
 */
const LEGAL_TOKEN_RE =
  /§\s*\d+(?:\.\d+)*|\([A-Za-z0-9][A-Za-z0-9-]*\)|\w+(?:-\w+)*|\s+|[^\s]/g;

export function tokenise(text: string): string[] {
  return text.match(LEGAL_TOKEN_RE) ?? [];
}

// ── LCS diff engine ───────────────────────────────────────────────────────────

/**
 * Safety threshold for the O(n×m) LCS matrix.
 * A 200-token paragraph diffed against another 200-token paragraph = 40,000 cells.
 * Beyond LCS_MAX_CELLS we fall back to a single block delete+insert, which is
 * equivalent to what the user would see after a "simplified view" gate anyway.
 */
const LCS_MAX_CELLS = 20_000;

/**
 * Run the classic LCS diff on two strings using the provided tokeniser.
 * Pass `s => s.split("")` for character-level granularity (see diffChars).
 *
 * Falls back to a single block delete+insert when the token matrix would
 * exceed LCS_MAX_CELLS cells to keep runtime bounded on long paragraphs.
 */
export function diffText(
  a: string,
  b: string,
  tokenizer: (s: string) => string[] = tokenise,
): DiffOp[] {
  const tokA = tokenizer(a);
  const tokB = tokenizer(b);
  const lenA = tokA.length;
  const lenB = tokB.length;

  // Fast path: O(n×m) guard — avoids quadratic blowup on long paragraphs.
  if (lenA * lenB > LCS_MAX_CELLS) {
    const ops: DiffOp[] = [];
    if (lenA > 0) ops.push({ type: "delete", text: a });
    if (lenB > 0) ops.push({ type: "insert", text: b });
    return ops;
  }

  // lcs[i][j] = LCS length of tokA[0..i-1] and tokB[0..j-1]
  const lcs: number[][] = Array.from({ length: lenA + 1 }, () =>
    new Array<number>(lenB + 1).fill(0),
  );

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      lcs[i]![j] =
        tokA[i - 1] === tokB[j - 1]
          ? lcs[i - 1]![j - 1]! + 1
          : Math.max(lcs[i - 1]![j]!, lcs[i]![j - 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = lenA;
  let j = lenB;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokA[i - 1] === tokB[j - 1]) {
      ops.push({ type: "keep", text: tokA[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      ops.push({ type: "insert", text: tokB[j - 1]! });
      j--;
    } else {
      ops.push({ type: "delete", text: tokA[i - 1]! });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Character-level diff — every character is its own token.
 * Use this for surgical intra-word edits (see expandCharLevel in
 * applyDiffAsSuggestion for how it integrates into the suggestion pipeline).
 */
export function diffChars(a: string, b: string): DiffOp[] {
  return diffText(a, b, s => s.split(""));
}

// ── Replacement grouping ──────────────────────────────────────────────────────

/**
 * Post-process a DiffOp array to identify replacement groups.
 *
 * A group starts at the first delete op and continues, bridging keep sequences
 * of up to `lookAheadTokens` consecutive keeps, until either no insert is
 * found or the keep run exceeds the threshold.
 *
 * All delete and insert ops within a group share the same `groupId`.
 * Keep ops within a group carry no groupId — they are unchanged context.
 *
 * Default look-ahead is 5 tokens, which handles most legal phrase replacements
 * ("of the Party" → "the Seller" keeps "the" and " " across the gap).
 *
 * Standalone deletes (no matching insert within the window) and standalone
 * inserts (not preceded by a delete) receive no groupId.
 */
export function pairReplacements(ops: DiffOp[], lookAheadTokens = 5): PairedDiffOp[] {
  const output: PairedDiffOp[] = [];
  const len = ops.length;
  let i = 0;

  while (i < len) {
    if (ops[i]!.type !== "delete") {
      output.push({ ...ops[i]! });
      i++;
      continue;
    }

    // Scan forward, bridging short keep sequences, to find the group extent.
    let j = i;
    let consecutiveKeeps = 0;
    let hasInsert = false;
    let lastNonKeepIdx = i;

    while (j < len) {
      const t = ops[j]!.type;
      if (t === "delete") {
        if (hasInsert) break; // no deletes after inserts have started — new group
        consecutiveKeeps = 0;
        lastNonKeepIdx = j;
        j++;
      } else if (t === "insert") {
        consecutiveKeeps = 0;
        lastNonKeepIdx = j;
        hasInsert = true;
        j++;
      } else {
        // keep
        if (hasInsert) break; // stop bridging after the insert phase
        consecutiveKeeps++;
        if (consecutiveKeeps > lookAheadTokens) break;
        j++;
      }
    }

    if (!hasInsert) {
      output.push({ ...ops[i]! });
      i++;
      continue;
    }

    // Deterministic: same input token positions → same id across all clients.
    const gid = `grp_${i}_${lastNonKeepIdx}`;

    // Find the last explicit delete in the group.
    // Keeps that fall BEFORE the last delete are sandwiched between two
    // deletions — they are part of the phrase being replaced and must be
    // absorbed into the group so the user sees the whole phrase replaced
    // (e.g. "~~any third party~~" instead of "~~any~~ third ~~party~~").
    // Keeps that fall AFTER the last delete are boundary separators and
    // remain as plain keeps in the output.
    let lastDeleteInGroup = i;
    for (let k = i; k <= lastNonKeepIdx; k++) {
      if (ops[k]!.type === "delete") lastDeleteInGroup = k;
    }

    const delPhase:  PairedDiffOp[] = [];
    const keepPhase: PairedDiffOp[] = [];
    const insPhase:  PairedDiffOp[] = [];

    for (let k = i; k <= lastNonKeepIdx; k++) {
      const op = ops[k]!;
      if (op.type === "delete") {
        delPhase.push({ ...op, groupId: gid });
      } else if (op.type === "insert") {
        insPhase.push({ ...op, groupId: gid });
      } else {
        // keep
        if (k < lastDeleteInGroup) {
          // Sandwiched — absorb: mark old text as deleted, re-insert it in target
          delPhase.push({ type: "delete", text: op.text, groupId: gid });
          insPhase.push({ type: "insert", text: op.text, groupId: gid });
        } else {
          // Boundary separator — stays as a plain keep (no groupId)
          keepPhase.push({ ...op });
        }
      }
    }

    // Output: all deletes first, then boundary keeps, then all inserts.
    // This ensures applyDiffAsSuggestion processes the full deleted range
    // before inserting the replacement, giving correct offset tracking.
    output.push(...delPhase, ...keepPhase, ...insPhase);
    i = lastNonKeepIdx + 1;
  }

  return output;
}

// ── Char-level expansion ──────────────────────────────────────────────────────

/**
 * Minimum character similarity (shared chars / longer token length) required
 * to trigger char-level expansion.
 *
 * 0.4 → at least 40% of the longer token's characters must be shared.
 * Below this the tokens are too dissimilar and char-level adds noise.
 *
 * Examples that PASS (similarity ≥ 0.4):
 *   indemnification → indemnity      (7/15 ≈ 0.47)
 *   liability       → liabilities    (9/11 ≈ 0.82)
 *   "Termination for Material Breach" → "Termination for Cause" — long but similar
 *
 * Examples that FAIL (similarity < 0.4):
 *   party  → seller   (0/6  = 0)
 *   quick  → slow     (0/5  = 0)
 *
 * No hard length limit: long tokens with genuine similarity still get surgical
 * marks, which is exactly what lawyers want for long legal terms.
 */
const CHAR_DIFF_SIMILARITY_THRESHOLD = 0.4;

/**
 * Expand strictly-adjacent single delete+insert pairs into char-level ops
 * when the two tokens are similar enough (similarity ≥ CHAR_DIFF_SIMILARITY_THRESHOLD).
 *
 * Only strictly adjacent pairs (no keep tokens between them) are considered —
 * bridged-gap groups involve multiple tokens and phrase-level semantics that
 * char-level expansion would fragment incorrectly.
 *
 * The `groupId` from the original word-level pair is preserved on every
 * char-level op so they still form one logical replacement.
 */
export function expandCharLevel(ops: PairedDiffOp[]): PairedDiffOp[] {
  const result: PairedDiffOp[] = [];
  let i = 0;

  while (i < ops.length) {
    const op   = ops[i]!;
    const next = ops[i + 1];

    if (
      op.type === "delete" &&
      next?.type === "insert" &&
      op.groupId &&
      op.groupId === next.groupId
    ) {
      const charOps = diffChars(op.text, next.text);
      const keptChars = charOps
        .filter(o => o.type === "keep")
        .reduce((s, o) => s + o.text.length, 0);
      const similarity = keptChars / Math.max(op.text.length, next.text.length, 1);

      if (similarity >= CHAR_DIFF_SIMILARITY_THRESHOLD) {
        const gid = op.groupId;
        result.push(...charOps.map(co =>
          gid ? { ...co, groupId: gid } : { ...co },
        ));
        i += 2; // consumed both delete and insert
        continue;
      }
    }

    result.push(op);
    i++;
  }

  return result;
}

// ── Noise filter ──────────────────────────────────────────────────────────────

/**
 * Compute the edit density of a diff: fraction of original characters deleted.
 *
 *   editDensity = deletedChars / (keptChars + deletedChars)
 *
 * Range: 0 (no deletions) → 1 (everything deleted).
 * Insertions are not counted in the denominator because they add new content
 * that wasn't in the original — we measure how much of the SOURCE changed.
 *
 * Usage: if editDensity > 0.4 the diff is "dense" and the consumer may want
 * to offer a simplified block-level "replace" view instead of fine-grained marks.
 */
export function computeEditDensity(ops: DiffOp[]): number {
  let kept = 0;
  let deleted = 0;
  for (const op of ops) {
    if (op.type === "keep")   kept    += op.text.length;
    if (op.type === "delete") deleted += op.text.length;
  }
  const source = kept + deleted;
  return source === 0 ? 0 : deleted / source;
}
