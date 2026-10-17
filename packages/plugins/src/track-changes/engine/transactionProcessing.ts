import { Node } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { isHistoryTransaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
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
  TrackingResult,
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

/** Records an indentation's steps as one move, by grouping them under one id. */
export function groupIndentationSteps(
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

/** Step kinds the replay knows how to re-apply as tracked content. */
function isTrackableStep(step: Step) {
  return (
    step instanceof ReplaceStep ||
    step instanceof ReplaceAroundStep ||
    step instanceof AttrStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  );
}

/**
 * Not content, so no record can be attached to it and none is missing by its
 * absence. Doc attributes carry page and section settings, written through
 * `tr.setDocAttribute`; refusing a gesture for containing one would call a
 * normal operation untrackable.
 */
function isUntrackedStep(step: Step) {
  return step instanceof DocAttrStep;
}

/**
 * The span a step says it affects, in the document it applied to. Mark and
 * attribute steps carry an empty StepMap, so a position map cannot describe
 * what they touched — only the step can. Callers that need to know what a
 * transaction rewrote must ask here rather than walking the maps.
 */
export function stepRange(step: Step): { from: number; to: number } | null {
  if (
    step instanceof ReplaceStep ||
    step instanceof ReplaceAroundStep ||
    step instanceof AddMarkStep ||
    step instanceof RemoveMarkStep
  ) {
    return { from: step.from, to: step.to };
  }
  if (
    step instanceof AttrStep ||
    step instanceof AddNodeMarkStep ||
    step instanceof RemoveNodeMarkStep
  ) {
    return { from: step.pos, to: step.pos };
  }
  return null;
}

function refuseStep(step: Step): TrackingRefusal | null {
  if (!(step instanceof ReplaceStep) && step.constructor.name === "ReplaceStep") {
    // Two copies of prosemirror-transform make every instanceof silently false.
    return { failure: "duplicate-transform-package" };
  }
  if (isUntrackedStep(step) || isTrackableStep(step)) return null;
  // Anything else would fall straight through the replay and land untracked, so
  // the gesture is refused whole instead of recorded in part.
  return { failure: "unsupported-step", stepType: step.constructor.name };
}

/**
 * Which outcome speaks for a dispatch. One dispatch can carry several
 * transactions, and a refusal is the one a host must act on — so the last
 * transaction must not be allowed to report success on behalf of all of them.
 */
export function reportedTracking(
  reported: TrackingResult | undefined,
  next: TrackingResult,
): TrackingResult {
  return reported?.status === "refused" ? reported : next;
}

/** Steps that carry authored content, and so count toward what was tracked. */
export const contentSteps = (steps: readonly Step[]) =>
  steps.filter(step => !isUntrackedStep(step));

/**
 * Decided before the replay touches anything, so a gesture is refused whole
 * rather than recorded in part. Size is deliberately not consulted: what
 * matters is whether every step can be represented, not how many there are.
 *
 * The question is only about step kinds. A supported kind does not yet promise
 * the gesture is recorded completely — the mark trackers stamp against
 * positions the replay bridge never mapped, so a gesture mixing a mark step
 * with a position-shifting one still under-records.
 */
export function trackingRefusal(steps: readonly Step[]) {
  for (const step of steps) {
    const refusal = refuseStep(step);
    if (refusal) return refusal;
  }
  return null;
}

/** Records which steps belong to one move, by grouping them under one id. */
export const groupMoveSteps = (
  tr: Transaction,
  context: TrTrackingContext,
): void => {
  const movingAssoc = context.stepsByGroupIDMap;

  if (tr.steps.length < 2) return;

  if (tr.getMeta(TrackChangesAction.structuralChangeAction)) {
    const commonID = genId();
    for (const step of tr.steps.slice(0, 2)) {
      if (step instanceof ReplaceStep) movingAssoc.set(step, commonID);
    }
    return;
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
