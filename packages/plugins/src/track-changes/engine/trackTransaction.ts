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

import { ChangeStep, TrTrackingContext } from "../types";
import { processChangeSteps } from "./processReplaceStep";
import {
  excludeFromTracking,
  passThroughMeta,
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
 * Entering an iteration the bridge maps `docs[i+1]` into the replayed document;
 * leaving it, `docs[i]`. Every step kind must advance it. The first replay map
 * is marked as mirroring the source step's own, which the position-changing
 * trackers earn by inverting the source step before re-applying it; mark
 * trackers emit empty maps, so the pairing is moot for them. A step the replay
 * declined still happened in the source — its map belongs in the chain even
 * when no replay steps followed.
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
  clearedSteps: (Step | null)[],
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
    const previousMapping = trContext.replayBridge.slice();
    const replayStart = newTr.mapping.maps.length;
    trackOneStep(i, step, baseAttrs, tr, oldState, newTr, trContext);
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
  emptyAttrs: NewEmptyAttrs,
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
        emptyAttrs,
        tr,
        replayBridge,
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
          ? { ...emptyAttrs, moveNodeId: trContext.stepsByGroupIDMap.get(step)! }
          : emptyAttrs,
        oldState.schema,
        replayBridge,
      );

      if (caretTrailsStep(tr, i, step)) {
        trContext.selectionPosFromInsertion =
          updatedSelectionPos || newSelectionPos || tr.selection.head;
      }
    } else if (step instanceof ReplaceAroundStep) {
      if (isSetNodeMarkupStep(step)) {
        const steps = trackSetNodeMarkupStep(step, newTr, emptyAttrs, tr.docs[i]!);
        if (steps.length > 0) processChangeSteps(steps, newTr, emptyAttrs, oldState.schema, replayBridge);
      } else {
        let steps = trackReplaceAroundStep(step, oldState, tr, newTr, emptyAttrs, tr.docs[i]!, trContext);
        steps = diffChangeSteps(steps);
        processChangeSteps(steps, newTr, emptyAttrs, oldState.schema, replayBridge);
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
        replayBridge,
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
