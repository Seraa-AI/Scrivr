import { EditorState, Transaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
} from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";
import { processChangeSteps } from "./processReplaceStep";
import {
  excludeFromTracking,
  passThroughMeta,
  stepIsTrackable,
} from "./transactionProcessing";
import { createNewPendingAttrs, genId, getNodeTrackedData, NewEmptyAttrs } from "../helpers";
import { fixAndSetSelectionAfterTracking } from "./fixAndSetSelectionAfterTracking";
import { updateChangeAttrs } from "./updateAttributes";
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
import { compositionAttrs } from "./composition";
import { trackReplaceStep } from "../step-trackers/trackReplaceStep";


/**
 * Did this step leave the caret where the gesture ended? A step's positions
 * belong to the document it applied to, so its result range has to be carried
 * forward through the steps that followed before it can be compared with the
 * selection — without that, the two are read in different frames and only
 * happen to agree for a lone step.
 */
function stepProducedSelection(tr: Transaction, i: number, step: ReplaceStep) {
  const forward = tr.mapping.slice(i + 1);
  const head = tr.selection.head;
  return (
    forward.map(step.from, -1) <= head &&
    head <= forward.map(step.from + step.slice.size, 1)
  );
}

/**
 * Entering an iteration the bridge maps `docs[i+1]` into the replayed document;
 * leaving it, `docs[i]`. Every step kind must advance it: each tracker begins by
 * inverting the source step, so the first replay map mirrors the step's own, and
 * a step the replay declined still happened in the source — its map belongs in
 * the chain even when no replay steps followed.
 */
function advanceBridge(
  step: Step,
  previous: Mapping,
  newTr: Transaction,
  replayStart: number,
) {
  const bridge = new Mapping([step.getMap()]);
  bridge.appendMapping(previous);
  if (newTr.mapping.maps.length > replayStart) {
    bridge.appendMap(newTr.mapping.maps[replayStart]!, 0);
    for (let j = replayStart + 1; j < newTr.mapping.maps.length; j++) {
      bridge.appendMap(newTr.mapping.maps[j]!);
    }
  }
  return bridge;
}

export function trackTransaction(
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  authorID: string,
  clearedSteps: Step[],
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

  for (let i = clearedSteps.length - 1; i >= 0; i--) {
    const step = clearedSteps[i];
    if (!step) continue;
    const emptyAttrs = compositionAttrs(tr.docs[i]!, step, baseAttrs);

    if (!stepIsTrackable(step)) continue;

    const previousMapping = trContext.deletedNodeMapping.slice();
    const replayStart = newTr.mapping.maps.length;
    trackOneStep(i, step, emptyAttrs, tr, oldState, newTr, trContext);
    trContext.deletedNodeMapping = advanceBridge(
      step,
      previousMapping,
      newTr,
      replayStart,
    );
  }

  newTr = passThroughMeta(tr, newTr);
  newTr = fixAndSetSelectionAfterTracking(newTr, tr, trContext);

  return newTr;
}

function trackOneStep(
  i: number,
  step: Step,
  emptyAttrs: NewEmptyAttrs,
  tr: Transaction,
  oldState: EditorState,
  newTr: Transaction,
  trContext: TrTrackingContext,
) {
  const deletedNodeMapping = trContext.deletedNodeMapping;
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
        emptyAttrs,
        tr,
        deletedNodeMapping,
        trContext,
      );

      let trackedContent = initialTrackedContent;
      if (trackedContent.length === 1) {
        const trackedStep = trackedContent[0] as any;
        if (
          excludeFromTracking(trackedStep?.node || trackedStep?.slice?.content?.content[0])
        ) {
          return;
        }
      }
      trackedContent = diffChangeSteps(trackedContent);

      const [, updatedSelectionPos] = processChangeSteps(
        trackedContent,
        newTr,
        trContext.stepsByGroupIDMap.has(step)
          ? { ...emptyAttrs, moveNodeId: trContext.stepsByGroupIDMap.get(step)! }
          : emptyAttrs,
        oldState.schema,
        deletedNodeMapping,
      );

      if (stepProducedSelection(tr, i, step)) {
        trContext.selectionPosFromInsertion =
          updatedSelectionPos || newSelectionPos || tr.selection.head;
      }
    } else if (step instanceof ReplaceAroundStep) {
      if (isSetNodeMarkupStep(step)) {
        const steps = trackSetNodeMarkupStep(step, newTr, emptyAttrs, tr.docs[i]!);
        if (steps.length > 0) processChangeSteps(steps, newTr, emptyAttrs, oldState.schema, deletedNodeMapping);
      } else {
        let steps = trackReplaceAroundStep(step, oldState, tr, newTr, emptyAttrs, tr.docs[i]!, trContext);
        steps = diffChangeSteps(steps);
        processChangeSteps(steps, newTr, emptyAttrs, oldState.schema, deletedNodeMapping);
      }
    } else if (step instanceof AttrStep) {
      const changeSteps = trackAttrsChangeStep(
        step,
        oldState,
        tr,
        newTr,
        emptyAttrs,
        tr.docs[i]!,
      );
      processChangeSteps(
        changeSteps,
        newTr,
        emptyAttrs,
        oldState.schema,
        deletedNodeMapping,
      );
    } else if (step instanceof AddMarkStep) {
      trackAddMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
      const dataTracked = getNodeTrackedData(
        newTr.doc.nodeAt(step.from),
        oldState.schema,
      )?.pop();
      if (dataTracked) {
        updateChangeAttrs(
          newTr,
          {
            id: dataTracked.id as string,
            from: step.from,
            to: step.to,
            type: "text-change",
            dataTracked,
          },
          { ...dataTracked, id: genId() },
          oldState.schema,
        );
      }
      // Fuse this tracked mark with same-author/same-attrs neighbours so a run
      // built from several edits stays one change (as typing already does).
      mergeTrackedMarks(step.from, newTr.doc, newTr, oldState.schema);
      mergeTrackedMarks(step.to, newTr.doc, newTr, oldState.schema);
    } else if (step instanceof RemoveMarkStep) {
      trackRemoveMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
      mergeTrackedMarks(step.from, newTr.doc, newTr, oldState.schema);
      mergeTrackedMarks(step.to, newTr.doc, newTr, oldState.schema);
    } else if (step instanceof RemoveNodeMarkStep) {
      trackRemoveNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
    } else if (step instanceof AddNodeMarkStep) {
      trackAddNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
    }
}
