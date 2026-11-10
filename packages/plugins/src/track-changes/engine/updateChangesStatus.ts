import { EditorState, Mapping, TextSelection, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_STATUS, type IncompleteChange, type TrackedChange } from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { checkReviewTransaction } from "./checkReviewTransaction";
import { applyChanges } from "../applyChanges";
import { revertSplitNodeChange } from "../lib/revertChanges";
import { acceptBreakDeletion } from "../lib/deleteBreak";
import { restoreListPlaces } from "../lib/listChange";
import type { ReviewDecision, ReviewOutcome, ReviewPlan } from "../reviewPlan";

/**
 * The same records, with the reviewed ones stamped. Returns the unvalidated
 * shape on purpose: spreading a change widens its discriminant, and `ChangeSet`
 * is the one place records are validated back into changes.
 */
function stampReviewed(
  changes: readonly TrackedChange[],
  statusOf: ReadonlyMap<string, CHANGE_STATUS>,
  userID: string,
  reviewedAt: number,
): IncompleteChange[] {
  return changes.map(change => {
    const status = statusOf.get(change.id);
    return {
      ...change,
      dataTracked: status
        ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: reviewedAt }
        : { ...change.dataTracked },
    };
  });
}

/**
 * Placements in the order they can be settled: one built on an earlier move
 * comes after it. Rejecting unwinds that order, so it runs backwards.
 */
function placementOrder(placements: readonly TrackedChange[], decision: ReviewDecision) {
  const ordered: TrackedChange[] = [];
  const visited = new Set<string>();
  const visit = (change: TrackedChange) => {
    if (visited.has(change.id)) return;
    visited.add(change.id);
    for (const id of change.dataTracked.placementDependsOn ?? []) {
      const parent = placements.find(other => other.id === id);
      if (parent) visit(parent);
    }
    ordered.push(change);
  };
  placements.forEach(visit);
  return decision === "rejected" ? ordered.reverse() : ordered;
}

/**
 * The order rejected moves and paragraph breaks can be undone in. A moved block
 * has to go back before it can rejoin the block it was split from. A move
 * restores one block, so a break made in its shadow has to be gone first.
 */
function restorationOrder(
  placements: readonly TrackedChange[],
  breaks: readonly TrackedChange[],
  changeSet: ChangeSet,
) {
  const inShadowOf = (breakRecord: TrackedChange, placement: TrackedChange) =>
    changeSet.changes.some(reference =>
      reference.dataTracked.operation === "reference" &&
      reference.dataTracked.referenceId === breakRecord.id &&
      changeSet.changes.some(shadow =>
        shadow.dataTracked.operation === "delete" &&
        shadow.dataTracked.moveNodeId === placement.dataTracked.moveNodeId &&
        shadow.from === reference.from));
  const waitsFor = (change: TrackedChange, other: TrackedChange) =>
    change.dataTracked.operation === "node_split"
      ? other.dataTracked.operation === "move" && other.from === change.from
      : other.dataTracked.operation === "node_split" && inShadowOf(other, change);

  const remaining = [...placements, ...breaks];
  const ordered: TrackedChange[] = [];
  while (remaining.length) {
    const next = remaining.findIndex(change => !remaining.some(other => waitsFor(change, other)));
    if (next < 0) throw new Error("These moves and paragraph breaks depend on one another");
    ordered.push(...remaining.splice(next, 1));
  }
  return ordered;
}

type ReadyPlan = Extract<ReviewPlan, { status: "ready" }>;

/**
 * Carries out a ready plan on a private transaction, then publishes the whole
 * result or nothing. Each change is applied by its own decision, so a conflict
 * resolution — one accepted, the others rejected — is still one review.
 *
 * Rejected placements, paragraph breaks and list changes are restored first, so content is
 * back where it began before anything destructive reads it. Restoring transports
 * content rather than shifting it, so nothing can be mapped across it: every
 * later stage reads its records from the document as restored. Accepted
 * placements settle last, once the content they carry is final, and accepted
 * break deletions after them, once the blocks either side are final.
 */
export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  plan: ReadyPlan,
  userID: string,
): ReviewOutcome {
  const decisions = { accepted: plan.accepted, rejected: plan.rejected };
  const statusOf = new Map<string, CHANGE_STATUS>([
    ...plan.accepted.map((id): [string, CHANGE_STATUS] => [id, CHANGE_STATUS.accepted]),
    ...plan.rejected.map((id): [string, CHANGE_STATUS] => [id, CHANGE_STATUS.rejected]),
  ]);
  // One review stamps one time, however many records it touches.
  const reviewedAt = Date.now();
  // Review must not mutate cached ChangeSet records or partially publish steps.
  const snapshot = new ChangeSet(stampReviewed(changeSet.changes, statusOf, userID, reviewedAt));
  const decided = (set: ChangeSet) => set.changes.filter(change => statusOf.has(change.id));
  const placements = (set: ChangeSet, decision: ReviewDecision) =>
    placementOrder(
      decided(set).filter(change =>
        change.dataTracked.operation === "move" && statusOf.get(change.id) === CHANGE_STATUS[decision]),
      decision,
    );
  const scratch = EditorState.create({ doc: createdTr.doc }).tr;
  let caret: { pos: number; stepsAfter: number } | undefined;
  try {
    const restoredPlacements = placements(snapshot, "rejected");
    const restoredBreaks = decided(snapshot).filter(change =>
      change.dataTracked.operation === "node_split" && statusOf.get(change.id) === CHANGE_STATUS.rejected);
    const restoreMapping = new Mapping();
    for (const change of restorationOrder(restoredPlacements, restoredBreaks, snapshot)) {
      if (change.dataTracked.operation === "node_split") revertSplitNodeChange(scratch, change);
      else applyChanges(scratch, scratch.doc.type.schema, [change], snapshot, restoreMapping);
    }
    const restoredLists = decided(snapshot).filter(change =>
      change.dataTracked.operation === "list_change" && statusOf.get(change.id) === CHANGE_STATUS.rejected);
    if (restoredLists.length) {
      const before = scratch.mapping.map(createdTr.selection.head);
      const placeOf = restoreListPlaces(scratch, new Set(restoredLists.map(change => change.id)));
      if (createdTr.selection.empty) caret = { pos: placeOf(before), stepsAfter: scratch.steps.length };
    }
    const current = restoredPlacements.length || restoredBreaks.length || restoredLists.length
      ? new ChangeSet(stampReviewed(
          findChanges(EditorState.create({ doc: scratch.doc })).changes, statusOf, userID, reviewedAt,
        ))
      : snapshot;
    const remaining = decided(current).filter(change => change.dataTracked.operation !== "move");
    const mapping = applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(change => !ChangeSet.isTextChange(change)), current);
    applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(ChangeSet.isTextChange), current, mapping);
    for (const change of placements(current, "accepted")) applyChanges(scratch, scratch.doc.type.schema, [change], current, mapping);
    const acceptedBreaks = remaining
      .filter(change => change.dataTracked.operation === "node_join" && statusOf.get(change.id) === CHANGE_STATUS.accepted)
      .sort((a, b) => b.from - a.from);
    for (const change of acceptedBreaks) acceptBreakDeletion(scratch, change.id);
    dropOrphanChanges(scratch);
    checkReviewTransaction(scratch);
    // The planner authorizes identities, not just document ranges. At the
    // publication boundary every selected identity must be settled and every
    // unselected pending identity must survive, even if an executor's effects
    // drift from the planner's model in a future change.
    const pending = new Set(findChanges(EditorState.create({ doc: scratch.doc })).pending.map(c => c.id));
    if ([...statusOf.keys()].some(id => pending.has(id)) ||
        changeSet.pending.some(c => !statusOf.has(c.id) && !pending.has(c.id))) {
      throw new Error("Review did not preserve the authorized set of change identities");
    }
  } catch (error) {
    // Nothing is published, and this is logged rather than only reported: an
    // engine invariant broke here, which is not a decision the reviewer made.
    console.error(
      "@scrivr/plugins track-changes: review produced an invalid result, no changes applied",
      error,
    );
    return { status: "blocked", ...decisions, reason: "invalid-result" };
  }
  for (const step of scratch.steps) createdTr.step(step);
  // Rebuilding a list maps the caret past it; it belongs in the text it was in.
  if (caret) {
    const pos = scratch.mapping.slice(caret.stepsAfter).map(caret.pos);
    createdTr.setSelection(TextSelection.near(createdTr.doc.resolve(pos)));
  }
  return { status: "applied", ...decisions };
}
