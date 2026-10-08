import { Node } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { isHistoryTransaction } from "@scrivr/core/pm";
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

import { isIndentationAction, TrackChangesAction } from "../actions";
import { genId } from "../helpers";
import {
  isDirectPendingMoveDeletion,
} from "../step-trackers/qualifiers";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  TrackedAttrs,
  TrackingRefusal,
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
 * Step kinds the replay knows how to re-apply as tracked content. A kind that
 * is not here would fall straight through the replay and land untracked, so the
 * gesture is refused whole instead of recorded in part.
 */
function refuseStep(step: Step): TrackingRefusal | null {
  if (!(step instanceof ReplaceStep) && step.constructor.name === "ReplaceStep") {
    // Two copies of prosemirror-transform make every instanceof silently false.
    return { failure: "duplicate-transform-package" };
  }
  const trackable =
    step instanceof ReplaceStep ||
    step instanceof ReplaceAroundStep ||
    step instanceof AttrStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep;
  return trackable
    ? null
    : { failure: "unsupported-step", stepType: step.constructor.name };
}

/**
 * Decided before the replay touches anything, so a gesture is either tracked in
 * full or refused in full. Size is deliberately not consulted: what matters is
 * whether every step can be represented, not how many there are.
 */
export function planTracking(steps: readonly (Step | null)[]) {
  for (const step of steps) {
    const refusal = step && refuseStep(step);
    if (refusal) return refusal;
  }
  return null;
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
  // A second move is a new placement decision. Reusing the previous move ID
  // loses the intermediate location and silently decides the first author's act.
  return tr.steps.slice();
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
