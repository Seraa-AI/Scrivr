/**
 * How formatting read off a document is compared against a proposal.
 *
 * Reading it is `acceptedMarksAt`'s, in @scrivr/plugins: the one reader every
 * lane indexes by, so computing a suggestion and rebasing one ask the same
 * question of the same offsets.
 */
import { stableStringify, type InlineMark } from "@scrivr/core";

function markKey(mark: InlineMark): string {
  return stableStringify([mark.type, mark.attrs ?? {}]);
}

/**
 * Do two runs read the same way?
 *
 * Order-insensitive and attrs-aware, because the two sides come from different
 * places: document marks arrive in schema order, and an agent emits them in
 * whatever order it wrote them. Comparing literally would read a reordered
 * `[bold, italic]` as a formatting change.
 */
export function sameMarks(a: readonly InlineMark[], b: readonly InlineMark[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(markKey).sort();
  const right = b.map(markKey).sort();
  return left.every((key, i) => key === right[i]);
}
