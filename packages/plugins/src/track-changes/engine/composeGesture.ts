import {
  AddMarkStep,
  type EditorState,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Selection,
  Slice,
  type Step,
  type Transaction,
} from "@scrivr/core/pm";

import { isSetNodeMarkupStep, isSplitStep } from "../step-trackers/qualifiers";
import { passThroughMeta, stepRange } from "./transactionProcessing";
import { TrackChangesAction } from "../actions";

/**
 * What a gesture's steps add up to, decided before the replay runs. The replay
 * walks steps backwards and restores an insertion wholesale, so work a later
 * step did inside that insertion has to be part of what gets restored.
 */
export type GestureComposition = {
  /** Steps whose whole effect is already in an earlier step's insertion. */
  folded: ReadonlySet<Step>;
  /** Insertions later steps changed, so what the replay restores is what they left. */
  composed: ReadonlySet<ReplaceStep>;
  /** A later step that writes both inside an insertion and outside it, and the insertion's edges then. */
  straddle?: { step: number; edges: [number, number] };
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

export function composeGesture(tr: Transaction): GestureComposition {
  const folded = new Set<Step>();
  const composed = new Set<ReplaceStep>();

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep) || step.slice.size === 0 || folded.has(step)) continue;

    // A paragraph break's text is carried, not inserted, so the replay cannot
    // record later work inside it as part of the break.
    const canHoldLaterWork = !isSplitStep(step, tr.docs[i]!, tr.getMeta("uiEvent"));
    let start = step.from;
    let end = step.from + step.slice.size;

    for (let j = i + 1; j < tr.steps.length && start < end; j++) {
      const later = tr.steps[j]!;
      const ranges = writtenRanges(later);
      const beside = ranges.every(range => range.to <= start || range.from >= end);
      const within = ranges.every(range => range.from >= start && range.to <= end);
      // A node that opened before the insertion is not part of it, whatever
      // token of it sits inside.
      const outsider = later instanceof ReplaceAroundStep && isSetNodeMarkupStep(later) && !within;
      if (!beside && !outsider && canHoldLaterWork) {
        if (within) folded.add(later);
        else if (!isMarkStep(later)) return { folded, composed, straddle: { step: j, edges: [start, end] } };
        composed.add(step);
      }
      const map = later.getMap();
      start = map.map(start, 1);
      end = map.map(end, -1);
    }
    // Later work took the whole insertion back: the two cancel, and there is
    // nothing left to restore or record.
    if (composed.has(step) && start >= end) {
      composed.delete(step);
      folded.add(step);
    }
  }
  return { folded, composed };
}

/**
 * Splits a straddling deletion, or an inline replacement within one block, at
 * the insertion's edges: inside, it takes back one's own text; outside, it
 * proposes deleting what was there. Null when the step can't be split so, or
 * `tr` does not start from `state`.
 */
export function splitAtInsertionEdges(
  tr: Transaction,
  straddle: NonNullable<GestureComposition["straddle"]>,
  state: EditorState,
): Transaction | null {
  const step = tr.steps[straddle.step];
  if (!(step instanceof ReplaceStep) || !state.doc.eq(tr.docs[0]!)) return null;
  // A deletion cuts anywhere. Content replacing the range has to land in one
  // block for the cut to leave it where the original put it.
  const doc = tr.docs[straddle.step]!;
  const inlineInOneBlock = step.slice.openStart === 0 && step.slice.openEnd === 0 &&
    !!step.slice.content.firstChild?.isInline && doc.resolve(step.from).sameParent(doc.resolve(step.to));
  if (step.slice.size > 0 && !inlineInOneBlock) return null;

  const edges = straddle.edges.filter(edge => step.from < edge && edge < step.to);
  // A cut between blocks would take an inserted block apart; only text cuts cleanly.
  if (edges.some(edge => !doc.resolve(edge).parent.inlineContent)) return null;
  const cuts = [step.from, ...edges, step.to];
  const split = state.tr.setTime(tr.time);
  for (let i = 0; i < tr.steps.length; i++) {
    if (i !== straddle.step) {
      if (split.maybeStep(tr.steps[i]!).failed) return null;
      continue;
    }
    // Right to left, so each cut still sits where it was measured; the new
    // content goes where the original put it, at the start.
    for (let c = cuts.length - 1; c > 0; c--) {
      const piece = new ReplaceStep(cuts[c - 1]!, cuts[c]!, c === 1 ? step.slice : Slice.empty);
      if (split.maybeStep(piece).failed) return null;
    }
  }
  if (tr.selectionSet) split.setSelection(Selection.fromJSON(split.doc, tr.selection.toJSON()));
  for (const action of Object.values(TrackChangesAction)) {
    if (tr.getMeta(action) !== undefined) split.setMeta(action, tr.getMeta(action));
  }
  return passThroughMeta(tr, split);
}
