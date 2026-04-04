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
import { isDeleteStep, isLiftStep, isSetNodeMarkupStep, isWrapStep } from "../step-trackers/qualifiers";
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
        // setNodeMarkup step — node type/attrs changed (e.g. heading h1→h2).
        // Treat it the same as an AttrStep: record an update-node-attrs change.
        const currentDoc = tr.docs[i]!;
        const nodePos: number = step.from;
        const currentNode = currentDoc.nodeAt(nodePos);
        const newNode = step.slice.content.firstChild;
        if (currentNode && newNode) {
          // Only track when something user-visible changed.
          // Strip nodeId and dataTracked (internal bookkeeping) before comparing
          // so that nodeId-assignment and accept/reject ops don't generate false
          // attribute-change entries.
          const { dataTracked: _dtA, nodeId: _nidA, ...currentMeaningful } = currentNode.attrs as Record<string, unknown>;
          const { dataTracked: _dtB, nodeId: _nidB, ...newMeaningful } = newNode.attrs as Record<string, unknown>;
          const typeChanged = currentNode.type !== newNode.type;
          const attrsChanged = JSON.stringify(currentMeaningful) !== JSON.stringify(newMeaningful);
          if (!typeChanged && !attrsChanged) {
            // Only bookkeeping fields changed (e.g. dataTracked or nodeId stamping).
            // The original transaction already applied the step — nothing to add.
          } else {
            const inverted = step.invert(currentDoc);
            const stepResult = newTr.maybeStep(inverted);
            if (!stepResult.failed) {
              const { dataTracked: _dt, ...currentAttrs } = currentNode.attrs as Record<string, unknown>;
              const { dataTracked: _dt2, nodeId: _nid, ...sliceAttrs } = newNode.attrs as Record<string, unknown>;
              // For same-type changes (e.g. h1→h2), merge old attrs so unset attrs
              // keep their existing values. For type changes (e.g. p→heading or
              // heading→p), use ONLY the new type's attrs — the old type may have
              // attrs (like `level`) that don't belong in the new type, which would
              // cause the attrs-diff guard to incorrectly see "no change".
              const newAttrs = typeChanged
                ? { ...sliceAttrs, nodeId: currentAttrs.nodeId }
                : { ...currentAttrs, ...sliceAttrs, nodeId: currentAttrs.nodeId };
              const changeStep: import("../types").ChangeStep = {
                pos: nodePos,
                type: "update-node-attrs",
                node: currentNode,
                newAttrs,
                ...(typeChanged ? { newNodeType: newNode.type } : {}),
              };
              processChangeSteps([changeStep], newTr, emptyAttrs, oldState.schema, deletedNodeMapping);
            }
          }
        }
      } else if (isWrapStep(step) || isLiftStep(step)) {
        // Wrap (e.g. blockquote) and lift operations.
        const changeSteps = trackReplaceAroundStep(
          step,
          oldState,
          tr,
          newTr,
          emptyAttrs,
          tr.docs[i]!,
          trContext,
        );
        if (changeSteps.length > 0) {
          processChangeSteps(changeSteps, newTr, emptyAttrs, oldState.schema, deletedNodeMapping);
        }
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
