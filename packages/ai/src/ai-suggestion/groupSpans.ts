/**
 * Where each group sits in the *accepted text* a proposal was computed
 * against — the coordinates a caller scoping an accept to a span speaks in.
 *
 * `buildGroupRanges` answers document positions, which is what an overlay
 * needs to paint. A caller that says "accept this sentence" has no document
 * positions: it has offsets into the text the model was shown.
 */
import type { AiOp } from "./types";

/** Half-open accepted-text span. A pure insertion is zero-width at its point. */
export interface GroupSpan {
  from: number;
  to: number;
}

/**
 * A span a caller names, plus the text its offsets were measured against.
 *
 * The text is what makes the offsets meaningful. Without it a span is three
 * numbers that address whatever happens to sit there now, which after any
 * accept is not what the caller was looking at.
 */
export interface AcceptedSpan extends GroupSpan {
  acceptedText: string;
}

/**
 * Pair each op with where it starts in the accepted text.
 *
 * The one place that rule lives: `keep` and `delete` describe text that is
 * already there and so consume it, while `insert` proposes text that is not
 * and consumes none, anchoring at the offset it reaches. Anything walking ops
 * against accepted-text coordinates reads it from here rather than restating
 * it — two walkers that disagree put a group in one map and not the other.
 */
export function* withAcceptedOffsets(
  ops: readonly AiOp[],
): Generator<{ op: AiOp; offset: number }> {
  let offset = 0;
  for (const op of ops) {
    yield { op, offset };
    if (op.type !== "insert") offset += op.text.length;
  }
}

/**
 * Walk a block's ops and collect each group's accepted-text span.
 *
 * A group's span is the hull of its ops'. Every producer emits a group's ops
 * contiguously, so nothing is swallowed between them.
 */
export function buildGroupSpans(ops: readonly AiOp[]): Map<string, GroupSpan> {
  const spans = new Map<string, GroupSpan>();

  for (const { op, offset } of withAcceptedOffsets(ops)) {
    if (!op.groupId) continue;
    const end = op.type === "insert" ? offset : offset + op.text.length;
    const span = spans.get(op.groupId);
    spans.set(
      op.groupId,
      span
        ? { from: Math.min(span.from, offset), to: Math.max(span.to, end) }
        : { from: offset, to: end },
    );
  }

  return spans;
}

/**
 * The groups a caller's span covers, in op order.
 *
 * A group the span only clips is left out. Half a replacement is not a smaller
 * replacement — it is a different one — so a reader who asked for one sentence
 * gets the changes that belong to it and nothing that straddles its edge.
 *
 * A pure insertion is zero-width, so containment alone would let both
 * sentences either side of it claim it, and a collapsed span claim one with
 * nothing selected. It belongs to the one span that starts at or before its
 * point and ends strictly after — which is exactly one span, and never an
 * empty one.
 *
 * Empty for a span that is inverted, collapsed, or reaches outside
 * `acceptedLength`: a span that describes nothing coherent is not a span that
 * should be guessed at.
 */
export function groupsWithin(
  ops: readonly AiOp[],
  range: GroupSpan,
  acceptedLength: number,
): string[] {
  if (range.from >= range.to) return [];
  if (range.from < 0 || range.to > acceptedLength) return [];

  const spans = buildGroupSpans(ops);
  const ordered: string[] = [];
  for (const op of ops) {
    if (!op.groupId || ordered.includes(op.groupId)) continue;
    const span = spans.get(op.groupId);
    if (!span) continue;
    const covered =
      span.from === span.to
        ? span.from >= range.from && span.from < range.to
        : span.from >= range.from && span.to <= range.to;
    if (covered) ordered.push(op.groupId);
  }
  return ordered;
}
