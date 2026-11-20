import type { Fragment, Transaction } from "@scrivr/core/pm";

import { acceptedRangeToDocRange, type PosMapEntry } from "./acceptedTextMap";
import type { PairedDiffOp } from "./diffText";

/**
 * Writes a block's diff into `tr` as the plain edits a person would make, for
 * the engine to record under `trackAsSuggestion`. `map` is the block's
 * accepted-text map, built on `tr.doc` when `tr` had `mapStep` steps; its
 * positions are mapped through what was written since, as a deletion removes
 * its text.
 *
 * Each phrase (a deletion and the insertion sharing its `groupId`) starts with
 * one step, the unit the engine pairs as one replacement. A deletion takes only the
 * characters the map read: an image or another author's struck text between
 * them is left in place, since the proposal never saw it.
 *
 * `contentFor(from, to)` builds what the proposal puts in for its text between
 * those offsets. `emptyAt` is where content goes in a block with no accepted
 * text. Returns whether anything was written.
 */
export function writeProposal(
  tr: Transaction,
  map: readonly PosMapEntry[],
  mapStep: number,
  ops: readonly PairedDiffOp[],
  contentFor: (from: number, to: number) => Fragment,
  emptyAt: number,
): boolean {
  const mapped = (pos: number, assoc: 1 | -1) => tr.mapping.slice(mapStep).map(pos, assoc);
  let accepted = 0;
  let proposed = 0;
  let written = false;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.type === "keep") {
      accepted += op.text.length;
      proposed += op.text.length;
      continue;
    }
    // A phrase: this op and the next when they are the two halves of one replacement.
    const next = ops[i + 1];
    const paired = op.type === "delete" && next?.type === "insert" && !!op.groupId && next.groupId === op.groupId;
    const removed = op.type === "delete" ? op.text.length : 0;
    const added = op.type === "insert" ? op.text.length : paired && next ? next.text.length : 0;
    if (paired) i++;

    const runs = docRuns(map, accepted, accepted + removed);
    const content = added > 0 ? contentFor(proposed, proposed + added) : null;
    const [first, ...rest] = runs;
    if (first) {
      if (content) tr.replaceWith(mapped(first.from, 1), mapped(first.to, -1), content);
      else tr.delete(mapped(first.from, 1), mapped(first.to, -1));
      for (const run of rest) tr.delete(mapped(run.from, 1), mapped(run.to, -1));
      written = true;
    } else if (content && content.size > 0) {
      const at = acceptedRangeToDocRange(map, accepted, accepted)?.from ?? (map.length === 0 ? emptyAt : null);
      if (at !== null) {
        tr.insert(mapped(at, 1), content);
        written = true;
      }
    }
    accepted += removed;
    proposed += added;
  }
  return written;
}

/** The doc ranges holding accepted characters `from`–`to`, split wherever the map skips content. */
function docRuns(map: readonly PosMapEntry[], from: number, to: number): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number }> = [];
  for (let k = from; k < to; k++) {
    const pos = map[k]?.docPos;
    if (pos === undefined) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === pos) last.to = pos + 1;
    else runs.push({ from: pos, to: pos + 1 });
  }
  return runs;
}
