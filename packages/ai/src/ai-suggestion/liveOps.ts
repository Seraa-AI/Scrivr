/**
 * The ops of a block that are still open for review.
 *
 * A group the reader has accepted or rejected is finished, but its op cannot
 * simply be dropped: every reader of an op stream counts text as it walks, so
 * removing one shifts every offset after it and the next op lands on the wrong
 * characters. A settled op is neutralised in place instead — it still occupies
 * the text it always did, it just no longer proposes anything.
 *
 * One place decides this. Four write paths and three read paths ask the same
 * question, and answering it separately in each is how a settled group kept its
 * underline and kept offering a card whose accept did nothing.
 */
import type { AiOp, AiSuggestionBlock } from "./types";

/** Is this op part of a group the reader has already settled? */
export function isResolved(block: AiSuggestionBlock, op: AiOp): boolean {
  return op.groupId !== undefined && (block.resolvedGroups ?? []).includes(op.groupId);
}

/**
 * `block.ops` with settled proposals neutralised.
 *
 * A settled formatting keep keeps its text and loses its marks, which is the
 * one field that made it a proposal — so it stops drawing, stops being offered,
 * and still advances the offsets of everything after it.
 *
 * Settled text groups keep their ops: a `delete` still describes text the
 * block's `acceptedText` contains, and dropping it would desynchronise the
 * accepted-text map every reader builds. The write paths skip them by group.
 */
export function liveOps(block: AiSuggestionBlock): AiOp[] {
  if (!block.resolvedGroups?.length) return block.ops;
  return block.ops.map((op) =>
    op.type === "keep" && op.marks && isResolved(block, op)
      ? { type: "keep" as const, text: op.text }
      : op,
  );
}
