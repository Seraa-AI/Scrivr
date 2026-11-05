import { EditorState, Transaction } from "@scrivr/core/pm";
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
import { fixAndSetSelectionAfterTracking } from "./fixAndSetSelectionAfterTracking";
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
 * Did the gesture's caret trail this step? A caret at the end of inserted
 * content trailed it, whoever placed it there. A deletion leaves nothing to
 * trail, so only a caret the gesture carried to its edge counts — one the
 * gesture placed there is its own choice, and is mapped like any other.
 *
 * A step's positions belong to the document it applied to, so its end is
 * carried forward through the steps that followed before it is compared with
 * the caret.
 */
function caretTrailsStep(tr: Transaction, i: number, step: ReplaceStep) {
  const { selection } = tr;
  if (!selection.empty) return false;
  if (step.slice.size === 0 && tr.selectionSet) return false;
  return tr.mapping.slice(i + 1).map(step.from + step.slice.size, -1) === selection.head;
}

/**
 * Where a caret inside an insertion the gesture went on to edit sits, counted
 * back from the insertion's end, which is what the replay reports.
 */
function caretInsideComposedInsertion(tr: Transaction, i: number, step: ReplaceStep) {
  const { selection } = tr;
  if (!selection.empty) return undefined;
  const later = tr.mapping.slice(i + 1);
  const end = later.map(step.from + step.slice.size, -1);
  if (selection.head < later.map(step.from, 1) || selection.head > end) return undefined;
  return end - selection.head;
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

  newTr = passThroughMeta(tr, newTr);
  newTr = fixAndSetSelectionAfterTracking(newTr, trContext);

  return newTr;
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

    const [, updatedSelectionPos] = processChangeSteps(
      trackedContent,
      newTr,
      trContext.stepsByGroupIDMap.has(step)
        ? { ...baseAttrs, moveNodeId: trContext.stepsByGroupIDMap.get(step)! }
        : baseAttrs,
      oldState.schema,
    );

    const placeCaret = (pos: number) => {
      trContext.caretAfterStep = { pos, replayedMaps: newTr.mapping.maps.length };
    };
    if (caretTrailsStep(tr, i, step)) {
      placeCaret(updatedSelectionPos || newSelectionPos || tr.selection.head);
    } else if (updatedSelectionPos && trContext.composition.composed.has(step)) {
      const fromEnd = caretInsideComposedInsertion(tr, i, step);
      if (fromEnd !== undefined) placeCaret(updatedSelectionPos - fromEnd);
    }
  } else if (step instanceof ReplaceAroundStep) {
    if (isSetNodeMarkupStep(step)) {
      const steps = trackSetNodeMarkupStep(step, newTr, baseAttrs, tr.docs[i]!, replayBridge);
      if (steps.length > 0) processChangeSteps(steps, newTr, baseAttrs, oldState.schema);
    } else {
      let steps = trackReplaceAroundStep(step, oldState, tr, newTr, baseAttrs, tr.docs[i]!, trContext);
      steps = diffChangeSteps(steps);
      processChangeSteps(steps, newTr, baseAttrs, oldState.schema);
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
