/**
 * How formatting is read off a document and compared against a proposal.
 *
 * Shared because two lanes depend on the *same* answers: computing a suggestion
 * asks what a run currently reads as so it can tell a real change from a
 * restatement, and rebasing a suggestion asks the same question so the parts
 * nobody proposed anything about survive untouched. Two copies of an
 * offset-alignment rule drift, and the drift is invisible until a proposal
 * lands on the wrong characters.
 */
import { describeInlineMark, type InlineMark } from "@scrivr/core";
import { isTrackedMark } from "@scrivr/plugins";
import type { Node as PmNode } from "@scrivr/core/pm";

import { stableStringify } from "@scrivr/core";

/**
 * The formatting each character of a block's accepted text carries.
 *
 * Indexed to match the accepted text — so tracked-deleted text is skipped here
 * exactly as it is there, because every offset in this lane is an index into
 * that text and counting it would misalign all of them.
 */
export function currentMarksAt(node: PmNode): InlineMark[][] {
  const marks: InlineMark[][] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((mark) => mark.type.name === "trackedDelete")) return;
    const described = child.marks
      .filter((mark) => !isTrackedMark(mark.type.name))
      .map(describeInlineMark);
    for (let i = 0; i < child.text.length; i++) marks.push(described);
  });
  return marks;
}

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
