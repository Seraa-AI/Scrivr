import { EditorState, Transaction } from "prosemirror-state";
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
} from "prosemirror-transform";

import { TrTrackingContext } from "../types";
import { processChangeSteps } from "./processReplaceStep";
import {
  excludeFromTracking,
  iterationIsValid,
  passThroughMeta,
} from "./transactionProcessing";
import { createNewPendingAttrs, genId, getNodeTrackedData } from "../helpers";
import { fixAndSetSelectionAfterTracking } from "./fixAndSetSelectionAfterTracking";
import { updateChangeAttrs } from "./updateAttributes";
import { diffChangeSteps } from "../lib/structuralChange";
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

  const emptyAttrs = createNewPendingAttrs(tr.time, authorID);

  const deletedNodeMapping = new Mapping();
  trContext = { ...trContext, deletedNodeMapping } as TrTrackingContext & {
    deletedNodeMapping: Mapping;
  };
  let iterations = 0;

  for (let i = clearedSteps.length - 1; i >= 0; i--) {
    const step = clearedSteps[i];
    if (!step) continue;

    iterations++;
    if (!iterationIsValid(iterations, tr, newTr, step)) continue;

    if (step instanceof ReplaceStep) {
      const { slice } = step;
      if (
        slice?.content?.content?.length === 1 &&
        excludeFromTracking(slice.content.content[0]!)
      ) {
        continue;
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
          continue;
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

      const finalPos =
        updatedSelectionPos || newSelectionPos || tr.selection.head;
      const userSelectionPos = tr.selection.head;
      const stepOverlapsSelection =
        (step.from <= userSelectionPos && userSelectionPos <= step.to) ||
        Math.abs(step.from - userSelectionPos) < 5;

      if (stepOverlapsSelection) {
        trContext.selectionPosFromInsertion = finalPos;
      } else if (trContext.selectionPosFromInsertion === undefined) {
        trContext.selectionPosFromInsertion = userSelectionPos;
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
    } else if (step instanceof RemoveMarkStep) {
      trackRemoveMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
    } else if (step instanceof RemoveNodeMarkStep) {
      trackRemoveNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
    } else if (step instanceof AddNodeMarkStep) {
      trackAddNodeMarkStep(step, emptyAttrs, newTr, tr.docs[i]!);
    }
  }

  newTr = passThroughMeta(tr, newTr);
  newTr = fixAndSetSelectionAfterTracking(
    newTr,
    tr,
    deletedNodeMapping,
    trContext,
  );

  return newTr;
}
