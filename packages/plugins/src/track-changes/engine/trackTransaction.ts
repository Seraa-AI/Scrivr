import { EditorState, Selection, Transaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
} from "@scrivr/core/pm";

import { ChangeStep, TrTrackingContext } from "../types";
import { processChangeSteps } from "./processReplaceStep";
import { advanceBridge } from "./replayBridge";
import {
  excludeFromTracking,
  passThroughMeta,
} from "./transactionProcessing";
import { createNewPendingAttrs, NewEmptyAttrs } from "../helpers";
import { diffChangeSteps } from "../lib/structuralChange";
import { mergeTrackedMarks } from "../lib/mergeTrackedMarks";
import { isSetNodeMarkupStep } from "../step-trackers/qualifiers";
import { trackReplaceAroundStep } from "../step-trackers/trackReplaceAroundStep";
import { trackSetNodeMarkupStep } from "../step-trackers/trackSetNodeMarkupStep";
import trackAttrsChangeStep from "../step-trackers/trackAttrsChangeStep";
import {
  trackAddMarkStep,
  trackAddNodeMarkStep,
  trackRemoveMarkStep,
  trackRemoveNodeMarkStep,
} from "../step-trackers/trackRemoveMarkStep";
import { trackReplaceStep } from "../step-trackers/trackReplaceStep";


/**
 * How far before this step's end the gesture left its caret, or null. Counted
 * from the end because the replay writes the content back, not always the way
 * the gesture did. Covers a caret at the end, inside the last block (a paste
 * ending in a table), or, after a deletion, at the nearest valid place. A
 * caret the gesture placed itself after a deletion is mapped like any other.
 */
function caretBeforeStepEnd(tr: Transaction, i: number, step: ReplaceStep): number | null {
  const { selection } = tr;
  if (!selection.empty) return null;
  if (step.slice.size === 0 && tr.selectionSet) return null;
  const later = tr.mapping.slice(i + 1);
  const end = later.map(step.from + step.slice.size, -1);
  if (end === selection.head) return 0;
  if (step.slice.size === 0) return Selection.near(tr.doc.resolve(end)).head === selection.head ? 0 : null;
  const insertedFrom = later.map(step.from, 1);
  return insertedFrom < selection.head && selection.head < end && !tr.doc.resolve(selection.head).sameParent(tr.doc.resolve(end))
    ? end - selection.head
    : null;
}

/**
 * The node a single tracked step would write, when it writes one. Used to ask
 * whether that node can carry a change record at all.
 */
function trackedContentNode(step: ChangeStep) {
  if ("node" in step && step.node) return step.node;
  if ("slice" in step) return step.slice.content.firstChild ?? undefined;
  return undefined;
}

export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  authorID: string,
  trContext: TrTrackingContext,
) {
  if (
    tr.getMeta("isPaginationChange") ||
    tr.getMeta("inserting") ||
    tr.getMeta("deleting")
  ) {
    return newTr;
  }

  const baseAttrs = createNewPendingAttrs(tr.time, authorID);

  for (let i = tr.steps.length - 1; i >= 0; i--) {
    const step = tr.steps[i]!;
    const previousMapping = trContext.replayBridge.slice();
    const replayStart = newTr.mapping.maps.length;
    if (!trContext.composition.folded.has(step)) {
      trackOneStep(i, step, baseAttrs, tr, oldState, newTr, trContext);
    }
    trContext.replayBridge = advanceBridge(
      step,
      previousMapping,
      newTr,
      replayStart,
    );
  }

  return passThroughMeta(tr, newTr);
}

function trackOneStep(
  i: number,
  step: Step,
  baseAttrs: NewEmptyAttrs,
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  trContext: TrTrackingContext,
) {
  const replayBridge = trContext.replayBridge;
  if (step instanceof ReplaceStep) {
    const { slice } = step;
    if (
      slice?.content?.content?.length === 1 &&
      excludeFromTracking(slice.content.content[0]!)
    ) {
      return;
    }

    const [initialTrackedContent, newSelectionPos] = trackReplaceStep(
      i,
      step,
      oldState,
      newTr,
      baseAttrs,
      tr,
      trContext,
    );

    let trackedContent = initialTrackedContent;
    const only = trackedContent.length === 1 ? trackedContent[0] : undefined;
    const onlyNode = only ? trackedContentNode(only) : undefined;
    if (onlyNode && excludeFromTracking(onlyNode)) return;
    trackedContent = diffChangeSteps(trackedContent);

    const moveNodeId = trContext.stepsByGroupIDMap.get(step);
    const moveId = trContext.textMoves.get(step);
    const recordedFrom = newTr.mapping.maps.length;
    const [, updatedSelectionPos] = processChangeSteps(
      trackedContent,
      newTr,
      { ...baseAttrs, ...(moveNodeId ? { moveNodeId } : {}), ...(moveId ? { moveId } : {}) },
      oldState.schema,
      trContext.replayedSelection.restamps,
    );

    const placeCaret = (pos: number) => {
      trContext.replayedSelection.caretAfterStep = { pos, replayedMaps: newTr.mapping.maps.length };
    };
    const fromEnd = caretBeforeStepEnd(tr, i, step);
    if (fromEnd !== null) {
      // The step's own caret predates what recording wrote, such as joining a break back.
      const stepCaret = newSelectionPos === undefined ? undefined : newTr.mapping.slice(recordedFrom).map(newSelectionPos);
      const end = updatedSelectionPos ?? stepCaret ?? tr.selection.head;
      // An end already inside text is where the caret was; one between blocks
      // is past the content the caret was left in, or, when the step only
      // removed a boundary there, before the text the caret went on into.
      const $end = newTr.doc.resolve(end);
      placeCaret($end.parent.inlineContent ? end : fromEnd === 0 ? Selection.near($end).head : end - fromEnd);
    }
  } else if (step instanceof ReplaceAroundStep) {
    if (isSetNodeMarkupStep(step)) {
      const steps = trackSetNodeMarkupStep(step, newTr, baseAttrs, tr.docs[i]!, replayBridge);
      if (steps.length > 0) processChangeSteps(steps, newTr, baseAttrs, oldState.schema, trContext.replayedSelection.restamps);
    } else {
      let steps = trackReplaceAroundStep(step, oldState, tr, newTr, baseAttrs, tr.docs[i]!, trContext);
      steps = diffChangeSteps(steps);
      processChangeSteps(steps, newTr, baseAttrs, oldState.schema, trContext.replayedSelection.restamps);
    }
  } else if (step instanceof AttrStep) {
    const changeSteps = trackAttrsChangeStep(
      step,
      oldState,
      tr,
      newTr,
      baseAttrs,
      tr.docs[i]!,
      replayBridge,
    );
    processChangeSteps(
      changeSteps,
      newTr,
      baseAttrs,
      oldState.schema,
      trContext.replayedSelection.restamps,
    );
  } else if (step instanceof AddMarkStep) {
    // Mark steps shift nothing, so the source step's positions are already
    // those of the document this iteration's bridge maps from.
    const placed = step.map(replayBridge);
    if (!(placed instanceof AddMarkStep)) return;
    trackAddMarkStep(placed, baseAttrs, newTr);
    // Fuse this tracked mark with same-author/same-attrs neighbours so a run
    // built from several edits stays one change (as typing already does).
    mergeTrackedMarks(placed.from, newTr.doc, newTr, oldState.schema);
    mergeTrackedMarks(placed.to, newTr.doc, newTr, oldState.schema);
  } else if (step instanceof RemoveMarkStep) {
    const placed = step.map(replayBridge);
    if (!(placed instanceof RemoveMarkStep)) return;
    trackRemoveMarkStep(step, placed, baseAttrs, newTr, tr.docs[i]!);
    mergeTrackedMarks(placed.from, newTr.doc, newTr, oldState.schema);
    mergeTrackedMarks(placed.to, newTr.doc, newTr, oldState.schema);
  } else if (step instanceof RemoveNodeMarkStep) {
    trackRemoveNodeMarkStep(step, baseAttrs, newTr, tr.docs[i]!, replayBridge);
  } else if (step instanceof AddNodeMarkStep) {
    trackAddNodeMarkStep(step, baseAttrs, newTr, tr.docs[i]!, replayBridge);
  }
}
