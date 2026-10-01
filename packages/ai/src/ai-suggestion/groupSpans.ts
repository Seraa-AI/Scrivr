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
 * Walk a block's ops and collect each group's accepted-text span.
 *
 * `keep` and `delete` consume accepted text; `insert` proposes text that is
 * not there yet and so consumes none, anchoring at the offset it reaches.
 */
export function buildGroupSpans(ops: readonly AiOp[]): Map<string, GroupSpan> {
  const spans = new Map<string, GroupSpan>();
  let offset = 0;

  for (const op of ops) {
    const consumes = op.type !== "insert";
    const end = consumes ? offset + op.text.length : offset;

    if (op.groupId) {
      const span = spans.get(op.groupId);
      spans.set(
        op.groupId,
        span
          ? { from: Math.min(span.from, offset), to: Math.max(span.to, end) }
          : { from: offset, to: end },
      );
    }
    offset = end;
  }

  return spans;
}

/**
 * The groups a caller's span covers *whole*, in op order.
 *
 * A group the span only clips is left out. Half a replacement is not a smaller
 * replacement — it is a different one — so a reader who asked for one sentence
 * gets the changes that belong to it and nothing that straddles its edge.
 */
export function groupsWithin(
  ops: readonly AiOp[],
  range: GroupSpan,
): string[] {
  const spans = buildGroupSpans(ops);
  const ordered: string[] = [];
  for (const op of ops) {
    if (!op.groupId || ordered.includes(op.groupId)) continue;
    const span = spans.get(op.groupId);
    if (span && span.from >= range.from && span.to <= range.to) ordered.push(op.groupId);
  }
  return ordered;
}
