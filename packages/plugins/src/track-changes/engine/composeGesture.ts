import { AddMarkStep, RemoveMarkStep, ReplaceStep, type Selection, type Step, type Transaction } from "@scrivr/core/pm";

import { isSplitStep } from "../step-trackers/qualifiers";
import { stepRange } from "./transactionProcessing";

/**
 * What a gesture's steps add up to, decided before the replay runs. The replay
 * walks steps backwards and restores an insertion wholesale, so work a later
 * step did inside that insertion has to be part of what gets restored.
 */
export type GestureComposition = {
  /** Steps whose whole effect is already in an earlier step's insertion. */
  folded: ReadonlySet<Step>;
  /** An insertion as the gesture left it, for those later steps changed. */
  composed: ReadonlyMap<ReplaceStep, ReplaceStep>;
  /** A later step writes both inside an insertion and outside it. */
  straddled: boolean;
};

type Range = { from: number; to: number };

/** What a step writes. A step can leave a gap it never touches, so this is not its full span. */
function writtenRanges(step: Step): Range[] {
  const ranges: Range[] = [];
  step.getMap().forEach((from, to) => ranges.push({ from, to }));
  if (ranges.length) return ranges;
  const range = stepRange(step);
  if (!range) return [];
  // A step addressing a node by position writes the node that opens there.
  return [range.from === range.to ? { from: range.from, to: range.to + 1 } : range];
}

const isMarkStep = (step: Step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep;

export function composeGesture(tr: Transaction, selection: Selection): GestureComposition {
  const folded = new Set<Step>();
  const composed = new Map<ReplaceStep, ReplaceStep>();

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep) || step.slice.size === 0 || folded.has(step)) continue;

    // A paragraph break's text is carried, not inserted, so the replay cannot
    // record later work inside it as part of the break.
    const canHoldLaterWork = !isSplitStep(step, selection, tr.getMeta("uiEvent"));
    let start = step.from;
    let end = step.from + step.slice.size;
    let content: ReplaceStep | undefined;

    for (let j = i + 1; j < tr.steps.length && start < end; j++) {
      const later = tr.steps[j]!;
      const ranges = writtenRanges(later);
      const beside = ranges.every(range => range.to <= start || range.from >= end);
      if (!beside) {
        const within = ranges.every(range => range.from >= start && range.to <= end);
        if (within && canHoldLaterWork) folded.add(later);
        else if (!isMarkStep(later) || !canHoldLaterWork) return { folded, composed, straddled: true };
      }
      const map = later.getMap();
      start = map.map(start, 1);
      end = map.map(end, -1);
      if (!beside) {
        const after = tr.docs[j + 1] ?? tr.doc;
        content = new ReplaceStep(step.from, step.to, after.slice(start, end));
      }
    }
    if (content) composed.set(step, content);
  }
  return { folded, composed, straddled: false };
}
