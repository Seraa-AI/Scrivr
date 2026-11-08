import { Node, Slice } from "@scrivr/core/pm";
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

/** Content taken or written whole; a slice cut open is part of something else. */
const whole = (slice: Slice) => slice.openStart === 0 && slice.openEnd === 0;

/**
 * A moved node keeps its id, so a deleted block with one is only moved by a copy
 * carrying the same id — not by a new block, or another, that only reads the same.
 */
const sameIdentity = (inserted: Node, deleted: Node) =>
  !deleted.attrs["nodeId"] || inserted.attrs["nodeId"] === deleted.attrs["nodeId"];

/**
 * Is `inserted` what `deleted` took away? A floating object alone in its
 * paragraph leaves with the paragraph, which holds nothing else to move.
 */
function movedContent(inserted: Node, deleted: Node): boolean {
  return (sameIdentity(inserted, deleted) && nodeContentEquals(inserted, deleted)) ||
    (deleted.isTextblock && deleted.childCount === 1 && nodeContentEquals(inserted, deleted.firstChild!));
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
function isNonContentStep(step: Step) {
  return step instanceof DocAttrStep;
}

/**
 * The span a step says it affects, in the document it applied to. Mark and
 * attribute steps carry an empty StepMap, so a position map cannot describe
 * what they touched — only the step can.
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

function refusalFor(step: Step): TrackingRefusal | null {
  if (!(step instanceof ReplaceStep) && step.constructor.name === "ReplaceStep") {
    // Two copies of prosemirror-transform make every instanceof silently false.
    return { reason: "duplicate-transform-package" };
  }
  if (isNonContentStep(step) || isTrackableStep(step)) return null;
  // Anything else would fall straight through the replay and land untracked, so
  // the gesture is refused whole instead of recorded in part.
  return { reason: "unsupported-step", stepType: step.constructor.name };
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
  steps.filter(step => !isNonContentStep(step));

/**
 * Decided before the replay touches anything, so a gesture is refused whole
 * rather than recorded in part. Size is deliberately not consulted: what
 * matters is whether every step can be represented, not how many there are.
 *
 * The question here is only about step kinds; whether the steps fit together is
 * `composeGesture`'s to answer.
 */
export function trackingRefusal(steps: readonly Step[]) {
  for (const step of steps) {
    const refusal = refusalFor(step);
    if (refusal) return refusal;
  }
  return null;
}

/** A step that replaces a range with a slice. */
type ContentStep = ReplaceStep | ReplaceAroundStep;

const contentStep = (step: Step | undefined): ContentStep | undefined =>
  step instanceof ReplaceStep || step instanceof ReplaceAroundStep ? step : undefined;

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
  // Text has no node to carry, so its move is the deletion and insertion
  // linked; a node is carried, keeping its identity.
  const pair = (a: ContentStep, b: ContentStep, moved: Node) => {
    const moves = moved.isText ? context.textMoves : movingAssoc;
    const id = genId();
    if (a instanceof ReplaceStep) moves.set(a, id);
    if (b instanceof ReplaceStep) moves.set(b, id);
  };

  for (let i = 0; i < tr.steps.length; i++) {
    if (matched.includes(i)) {
      continue;
    }
    const step = contentStep(tr.steps[i]);
    const doc = tr.docs[i];

    if (!step) {
      continue;
    }
    const stepDeletesContent = step.from !== step.to && step.slice.size === 0;
    const stepInsertsContent =
      step.slice.size && step.slice.content.firstChild ? true : false;

    for (let g = 0; g < tr.steps.length; g++) {
      if (g === i || matched.includes(g)) {
        continue;
      }
      const peerStep = contentStep(tr.steps[g]);

      if (!peerStep) {
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
          whole(peerStep.slice) &&
          whole(deletedContent) &&
          deletedContent.content.firstChild &&
          movedContent(
            peerStep.slice.content.firstChild,
            deletedContent.content.firstChild,
          )
        ) {
          pair(peerStep, step, deletedContent.content.firstChild);
          matched.push(i, g);
          break;
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
          whole(insertedContent) &&
          whole(deletedPeerContent) &&
          insertedContent.content.firstChild &&
          deletedPeerContent.content.firstChild &&
          movedContent(
            insertedContent.content.firstChild,
            deletedPeerContent.content.firstChild,
          )
        ) {
          pair(peerStep, step, insertedContent.content.firstChild);
          matched.push(i, g);
          break;
        }
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
