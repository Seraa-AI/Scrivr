/**
 * diffText — legal-aware LCS diff with replacement grouping and phrase replacements.
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
 * ## Phrase replacements
 * phraseReplacements() turns a word-level diff into the edits a person would
 * make: each run of changes, bridging short unchanged gaps, is one deletion of
 * the old words and one insertion of the new — never a change inside a word.
 * The tracked paths (applyDiffAsSuggestion, applyRichDiffAsSuggestion) and the
 * AI suggestion overlay use it, so a proposal reads the same before and after
 * it becomes tracked changes.
 *
 * ## Noise filter
 * computeEditDensity() returns the fraction of original characters that were
 * deleted, giving callers a quality gate to decide whether to surface the
 * fine-grained diff or offer a simplified "replace block" view.
 *
 * No external dependencies — pure TypeScript.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * `keep` and `insert` carry `proposedOffset` — where in the proposed text their
 * content came from. `delete` describes text that exists only in the document,
 * so the field is absent from that arm rather than merely unset.
 *
 * Stated by the producer because it cannot be recovered downstream:
 * `pairReplacements` hoists a group's deletes ahead of the text that replaces
 * them, so a consumer counting proposal characters as it walks the emitted ops
 * drifts at every replacement and lands on the wrong words.
 */
export type DiffOp =
  | { type: "keep";   text: string; proposedOffset?: number }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string; proposedOffset?: number };

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

  // Unchanged text is the answer without a diff, and it has to be checked
  // before the size guard below: a formatting-only proposal restates the text
  // exactly, and answering "delete everything, insert everything" for two
  // identical strings rewrites every character to change none of them.
  if (a === b) return a.length > 0 ? [{ type: "keep", text: a, proposedOffset: 0 }] : [];

  // Fast path: O(n×m) guard — avoids quadratic blowup on long paragraphs.
  if (lenA * lenB > LCS_MAX_CELLS) {
    const ops: DiffOp[] = [];
    if (lenA > 0) ops.push({ type: "delete", text: a });
    if (lenB > 0) ops.push({ type: "insert", text: b, proposedOffset: 0 });
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

  ops.reverse();

  // Stamp each op with where its text sits in the proposal. Done here, in
  // emission order, because this is the last point at which that order is the
  // proposal's own.
  let proposedOffset = 0;
  for (const op of ops) {
    if (op.type === "delete") continue;
    op.proposedOffset = proposedOffset;
    proposedOffset += op.text.length;
  }
  return ops;
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
          // Sandwiched — absorb: mark old text as deleted, re-insert it in
          // target. The re-insert is the same proposed text the keep was, so it
          // keeps the keep's place in the proposal; the delete describes the
          // document copy and carries none.
          delPhase.push({ type: "delete", text: op.text, groupId: gid });
          insPhase.push({ ...op, type: "insert", groupId: gid });
        } else {
          // Boundary separator — stays as a plain keep (no groupId)
          keepPhase.push({ ...op });
        }
      }
    }

    // Deletes first, so a consumer applying the diff clears the whole deleted
    // range before writing the replacement into it — that is what keeps its
    // document-side offsets correct.
    //
    // What follows consumes the proposal, and is emitted in the proposal's own
    // order. Absorbing a sandwiched keep turns it into a re-insert, and that
    // re-insert can belong *before* a boundary keep: "alpha beta gamma delta"
    // → "beta delta epsilon" re-inserts "beta" at the start of the proposal.
    // Emitting every insert after every keep put it after "delta", so applying
    // the diff produced " deltabeta epsilon" — the ops no longer described the
    // proposal they were built from.
    const startsAt = (op: PairedDiffOp) => (op.type === "delete" ? 0 : op.proposedOffset ?? 0);
    const proposalOrder = [...keepPhase, ...insPhase].sort((x, y) => startsAt(x) - startsAt(y));
    output.push(...delPhase, ...proposalOrder);
    i = lastNonKeepIdx + 1;
  }

  return output;
}

// ── Phrase replacements ───────────────────────────────────────────────────────

/**
 * A diff as a person would make the edit: each run of changes becomes one
 * deletion of the old words and one insertion of the new, as when someone
 * selects text and types over it. An unchanged gap of up to `bridgeTokens`
 * tokens — a space, a comma, a word — inside what is being replaced is taken
 * in, when `canBridge` allows its accepted-text range; additions near each
 * other stay additions. A replacement's two halves share a groupId, unique
 * within this diff. The insertion carries where its text starts in the proposal.
 */
export function phraseReplacements(
  ops: DiffOp[],
  canBridge: (acceptedFrom: number, acceptedTo: number) => boolean = () => true,
  bridgeTokens = 5,
): PairedDiffOp[] {
  // Where each op starts in the accepted text, which keeps and deletes advance.
  const starts: number[] = [];
  let offset = 0;
  for (const op of ops) {
    starts.push(offset);
    if (op.type !== "insert") offset += op.text.length;
  }

  const out: PairedDiffOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (!op) break;
    if (op.type === "keep") {
      out.push(op);
      i++;
      continue;
    }
    let last = i;
    let deletes = op.type === "delete";
    let j = i + 1;
    while (j < ops.length) {
      const next = ops[j];
      if (next && next.type !== "keep") {
        deletes ||= next.type === "delete";
        last = j++;
        continue;
      }
      let gapEnd = j;
      while (gapEnd < ops.length && ops[gapEnd]?.type === "keep") gapEnd++;
      const gapFrom = starts[j] ?? 0;
      const gapTo = starts[gapEnd] ?? offset;
      if (!deletes || gapEnd === ops.length || gapEnd - j > bridgeTokens || !canBridge(gapFrom, gapTo)) break;
      j = gapEnd;
    }
    const region = ops.slice(i, last + 1);
    const removed = region.filter((o) => o.type !== "insert").map((o) => o.text).join("");
    const added = region.filter((o) => o.type !== "delete").map((o) => o.text).join("");
    const pair = removed && added ? { groupId: `grp_${i}_${last}` } : {};
    if (removed) out.push({ type: "delete", text: removed, ...pair });
    const proposedOffset = region.find((o) => o.type !== "delete")?.proposedOffset;
    if (added) out.push({ type: "insert", text: added, ...pair, ...(proposedOffset === undefined ? {} : { proposedOffset }) });
    i = last + 1;
  }
  return out;
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
