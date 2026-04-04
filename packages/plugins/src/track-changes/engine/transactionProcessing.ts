import { Node } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { isHistoryTransaction } from "prosemirror-history";
import { ReplaceStep, Step } from "prosemirror-transform";

import { isIndentationAction, TrackChangesAction } from "../actions";
import { ChangeSet } from "../ChangeSet";
import { genId } from "../helpers";
import {
  isDeletingPendingMovedNode,
  isDirectPendingMoveDeletion,
} from "../step-trackers/qualifiers";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  TrackedAttrs,
  TrTrackingContext,
} from "../types";

/**
 * Bookkeeping attrs that are excluded when comparing nodes for move detection.
 * These fields change independently of user content (timestamps, tracking IDs)
 * and must not cause a false mismatch between the deleted and inserted node.
 */
const BOOKKEEPING_ATTRS = new Set(["dataTracked", "nodeId"]);

/**
 * Deep-equals two ProseMirror nodes by semantic content, stripping bookkeeping
 * attrs so that a moved node carrying dataTracked still matches its original.
 */
function nodeContentEquals(a: Node, b: Node): boolean {
  if (a.type !== b.type) return false;
  if (a.isText) return a.text === b.text;
  const stripBookkeeping = (attrs: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(attrs).filter(([k]) => !BOOKKEEPING_ATTRS.has(k)));
  if (JSON.stringify(stripBookkeeping(a.attrs)) !== JSON.stringify(stripBookkeeping(b.attrs))) return false;
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    if (!nodeContentEquals(a.child(i), b.child(i))) return false;
  }
  return true;
}

export function passThroughMeta(oldTr: Transaction, newTr: Transaction) {
  oldTr.getMeta("inputType") &&
    newTr.setMeta("inputType", oldTr.getMeta("inputType"));
  oldTr.getMeta("uiEvent") &&
    newTr.setMeta("uiEvent", oldTr.getMeta("uiEvent"));
  return newTr;
}

export function getIndentationOperationSteps(
  tr: Transaction,
  trContext: TrTrackingContext,
) {
  if (isIndentationAction(trContext.action)) {
    const moveId = genId();
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      if (step instanceof ReplaceStep) {
        trContext.stepsByGroupIDMap.set(step, moveId);
      }
    }
  }
}

export const excludeFromTracking = (node: Node) => {
  if (node.isText) {
    return false;
  }
  return node && !node.type.spec.attrs?.dataTracked;
};

/**
 * Upper bound on tracked steps per transaction for typical edits.
 * Cut operations and mass-replace bypass this limit because they legitimately
 * generate large step counts. If a normal edit exceeds this limit it most
 * likely indicates a loop or unsupported step type — tracking is skipped and
 * an error is logged so the issue can be reproduced and reported.
 */
const MAX_TRACKED_STEPS_PER_TR = 20;

export function iterationIsValid(
  iterations: number,
  oldTr: Transaction,
  newTr: Transaction,
  step: Step,
) {
  const uiEvent = oldTr.getMeta("uiEvent");
  const isMassReplace = oldTr.getMeta("massSearchReplace");
  if (iterations > MAX_TRACKED_STEPS_PER_TR && uiEvent != "cut" && !isMassReplace) {
    console.error(
      "@scrivr/plugins track-changes: Possible infinite loop in iterating tr.steps, tracking skipped!\n" +
        "This is probably an error with the library, please report back to maintainers with a reproduction if possible",
      newTr,
    );
    return false;
  } else if (
    !(step instanceof ReplaceStep) &&
    step.constructor.name === "ReplaceStep"
  ) {
    console.error(
      "@scrivr/plugins track-changes: Multiple prosemirror-transform packages imported, alias/dedupe them " +
        "or instanceof checks fail as well as creating new steps",
    );
    return false;
  }
  return true;
}

export const getMoveOperationsSteps = (
  tr: Transaction,
  context: TrTrackingContext,
) => {
  const movingAssoc = context.stepsByGroupIDMap;

  if (tr.steps.length < 2) {
    return movingAssoc;
  }

  if (tr.getMeta(TrackChangesAction.structuralChangeAction)) {
    const commonID = genId();
    movingAssoc.set(tr.steps[0] as ReplaceStep, commonID);
    movingAssoc.set(tr.steps[1] as ReplaceStep, commonID);
    return movingAssoc;
  }

  const matched: number[] = [];

  for (let i = 0; i < tr.steps.length; i++) {
    if (matched.includes(i)) {
      continue;
    }
    const step = tr.steps[i] as ReplaceStep;
    const doc = tr.docs[i];

    if (!step.slice) {
      continue;
    }
    const stepDeletesContent = step.from !== step.to && step.slice.size === 0;
    const stepInsertsContent =
      step.slice.size && step.slice.content.firstChild ? true : false;

    for (let g = 0; g < tr.steps.length; g++) {
      if (g === i || matched.includes(g)) {
        continue;
      }
      const peerStep = tr.steps[g] as ReplaceStep;

      if (!peerStep.slice) {
        continue;
      }
      const peerStepInsertsContent =
        peerStep.slice.size && peerStep.slice.content.firstChild;
      const peerStepDeletesContent =
        peerStep.from !== peerStep.to && peerStep.slice.size === 0;

      if (stepDeletesContent) {
        const deletedContent = doc!.slice(step.from, step.to);

        if (
          peerStepInsertsContent &&
          deletedContent.content.firstChild &&
          nodeContentEquals(
            peerStep.slice.content.firstChild,
            deletedContent.content.firstChild,
          )
        ) {
          const commonID = genId();
          movingAssoc.set(peerStep, commonID);
          movingAssoc.set(step, commonID);
          matched.push(i, g);
        }
        continue;
      }

      if (stepInsertsContent && peerStepDeletesContent) {
        const insertedContent = step.slice;
        const deletedPeerContent = tr.docs[g]!.slice(
          peerStep.from,
          peerStep.to,
        );
        if (
          insertedContent.content.firstChild &&
          deletedPeerContent.content.firstChild &&
          nodeContentEquals(
            insertedContent.content.firstChild,
            deletedPeerContent.content.firstChild,
          )
        ) {
          const commonID = genId();
          movingAssoc.set(peerStep, commonID);
          movingAssoc.set(step, commonID);
        }
        matched.push(i, g);
      }
    }
  }
};

export const filterMeaninglessMoveSteps = (
  tr: Transaction,
  context: TrTrackingContext,
) => {
  const cleanSteps: Array<Step | null> = [];

  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    const moveID = context.stepsByGroupIDMap.get(step as ReplaceStep);

    if (moveID) {
      const prevMoveID = isDeletingPendingMovedNode(
        step as ReplaceStep,
        tr.docs[i]!,
      );
      if (prevMoveID) {
        context.stepsByGroupIDMap.forEach((replaceStepMoveID, replaceStep) => {
          if (replaceStep !== step && moveID === replaceStepMoveID) {
            context.stepsByGroupIDMap.set(replaceStep, prevMoveID);
          }
        });
        cleanSteps.push(null);
        continue;
      }

      if (
        step instanceof ReplaceStep &&
        !tr.getMeta(TrackChangesAction.structuralChangeAction)
      ) {
        const { slice } = step;
        if (slice?.content?.firstChild) {
          const insertedNode = slice.content.firstChild;
          if (insertedNode.attrs.dataTracked) {
            const isPendingInsert = ChangeSet.isPendingChange(
              insertedNode.attrs.dataTracked as TrackedAttrs[],
              CHANGE_OPERATION.insert,
            );
            if (isPendingInsert) {
              cleanSteps.push(null);
              continue;
            }
          }
        }
      }
    }

    cleanSteps.push(step || null);
  }
  return cleanSteps;
};


export const trFromHistory = (tr: Transaction): boolean => isHistoryTransaction(tr);
export const changeMovedToInsertsOnSourceDeletion = (
  tr: Transaction,
  newTr: Transaction,
  trContext: TrTrackingContext,
) => {
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (step instanceof ReplaceStep) {
      const doc = tr.docs[tr.steps.indexOf(step)]!;
      if (isDirectPendingMoveDeletion(step, doc, trContext.stepsByGroupIDMap)) {
        const node = doc.nodeAt(step.from);
        if (node?.attrs.dataTracked) {
          newTr.setNodeMarkup(step.from, undefined, {
            ...node.attrs,
            dataTracked: node.attrs.dataTracked.filter(
              (t: TrackedAttrs) =>
                !(
                  t.operation === CHANGE_OPERATION.move &&
                  t.status === CHANGE_STATUS.pending
                ),
            ),
          });
        }
      }
    }
  }
};
