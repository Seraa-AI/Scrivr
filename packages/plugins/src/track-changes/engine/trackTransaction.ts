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
import { createNewPendingAttrs, getNodeTrackedData } from "../helpers";
import { fixAndSetSelectionAfterTracking } from "./fixAndSetSelectionAfterTracking";
import { updateChangeAttrs } from "./updateAttributes";
import { diffChangeSteps, isStructuralChange } from "../lib/structuralChange";
import { isDeleteStep, isSetNodeMarkupStep } from "../step-trackers/qualifiers";
import { trackReplaceAroundStep } from "../step-trackers/trackReplaceAroundStep";
import trackAttrsChangeStep from "../step-trackers/trackAttrsChangeStep";
import {
  trackAddMarkStep,
  trackAddNodeMarkStep,
  trackRemoveMarkStep,
  trackRemoveNodeMarkStep,
} from "../step-trackers/trackRemoveMarkStep";
import { trackReplaceStep } from "../step-trackers/trackReplaceStep";

const genId = () => Math.random().toString(36).slice(2, 10);

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

      let thisStepMapping = tr.mapping.slice(i + 1, i + 1);
      if (isDeleteStep(step) || isStructuralChange(tr)) {
        thisStepMapping = deletedNodeMapping;
      }

      const [initialTrackedContent, newSelectionPos] = trackReplaceStep(
        i,
        oldState,
        newTr,
        emptyAttrs,
        tr,
        thisStepMapping,
        trContext,
      );

      let trackedContent = initialTrackedContent;
      if (trackedContent.length === 1) {
        const step: any = trackedContent[0];
        if (
          excludeFromTracking(step?.node || step?.slice?.content?.content[0])
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
        // Node type or attrs change (paragraph↔heading, h1→h2, ul↔ol, etc.).
        // trackReplaceAroundStep can't handle this — it tries to insert the new
        // node wrapper inside the gap, producing an invalid document. Instead,
        // invert the step to restore the old node, then record an update-node-attrs
        // change that processChangeSteps applies via setNodeMarkup.
        const currentDoc = tr.docs[i]!;
        const currentNode = currentDoc.nodeAt(step.from);
        const newNode = step.slice.content.firstChild;
        if (currentNode && newNode) {
          const { dataTracked: _a, nodeId: _b, ...oldMeaningful } = currentNode.attrs as Record<string, unknown>;
          const { dataTracked: _c, nodeId: _d, ...newMeaningful } = newNode.attrs as Record<string, unknown>;
          const typeChanged = currentNode.type !== newNode.type;
          if (typeChanged || JSON.stringify(oldMeaningful) !== JSON.stringify(newMeaningful)) {
            const inverted = step.invert(currentDoc);
            if (!newTr.maybeStep(inverted).failed) {
              const { dataTracked: _dt, nodeId, ...currentAttrs } = currentNode.attrs as Record<string, unknown>;
              const { dataTracked: _dt2, nodeId: _nid, ...sliceAttrs } = newNode.attrs as Record<string, unknown>;
              // Type change: use only the new type's attrs (avoid leaking attrs that
              // don't belong to the new type, e.g. `level` from heading into paragraph).
              const newAttrs = typeChanged
                ? { ...sliceAttrs, nodeId }
                : { ...currentAttrs, ...sliceAttrs, nodeId };
              processChangeSteps([{
                pos: step.from,
                type: "update-node-attrs",
                node: currentNode,
                newAttrs,
                ...(typeChanged ? { newNodeType: newNode.type } : {}),
              }], newTr, emptyAttrs, oldState.schema, deletedNodeMapping);
            }
          }
        }
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
