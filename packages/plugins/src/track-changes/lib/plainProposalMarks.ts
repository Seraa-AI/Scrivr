import type { InlineMark } from "@scrivr/core";
import type { Node as PMNode, Schema } from "@scrivr/core/pm";
import { collectAccepted } from "./acceptedTextMap";
import type { PairedDiffOp } from "./diffText";

/**
 * The formatting each character of a plain-text proposal takes, indexed by its
 * offset in the proposal, as typing does in Word: kept text keeps its own, a
 * replacement takes the formatting of the first character it replaces, and an
 * insertion takes the character's before it — or after it, at the start of the
 * block — leaving out marks that do not grow at their edge, such as a link.
 *
 * `ops` are the block's accepted text diffed against the proposal.
 */
export function plainProposalMarks(ops: readonly PairedDiffOp[], block: PMNode, schema: Schema): InlineMark[][] {
  const chars = collectAccepted(block, 0, schema);
  const marksAt: InlineMark[][] = [];
  const grows = (mark: InlineMark) => schema.marks[mark.type]?.spec.inclusive !== false;
  let accepted = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.type === "keep") {
      for (let k = 0; k < op.text.length; k++) marksAt.push(chars[accepted + k]?.marks ?? []);
      accepted += op.text.length;
      continue;
    }
    // A phrase: this op and those after it, up to the next keep.
    let end = i;
    while (ops[end + 1] && ops[end + 1]!.type !== "keep") end++;
    const phrase = ops.slice(i, end + 1);
    const removed = phrase.some((o) => o.type === "delete");
    const marks = removed
      ? chars[accepted]?.marks ?? []
      : (chars[accepted - 1] ?? chars[accepted])?.marks.filter(grows) ?? [];
    for (const o of phrase) {
      if (o.type === "delete") accepted += o.text.length;
      else for (let k = 0; k < o.text.length; k++) marksAt.push(marks);
    }
    i = end;
  }
  return marksAt;
}
