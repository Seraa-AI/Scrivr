import { EditorState, Mapping, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_STATUS, type IncompleteChange, type TrackedChange } from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { checkReviewTransaction } from "./checkReviewTransaction";
import { applyChanges } from "../applyChanges";
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

type ReadyPlan = Extract<ReviewPlan, { status: "ready" }>;

/**
 * Carries out a ready plan on a private transaction, then publishes the whole
 * result or nothing. Each change is applied by its own decision, so a conflict
 * resolution — one accepted, the others rejected — is still one review.
 *
 * Rejected placements are restored first, so a creation that moved is back
 * where it began before anything destructive reads it; accepted placements
 * settle last, once the content they carry is final.
 */
export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  plan: ReadyPlan,
  userID: string,
): ReviewOutcome {
  const decisions = { accepted: plan.accepted, rejected: plan.rejected };
  const statusOf = new Map<string, CHANGE_STATUS>([
    ...plan.accepted.map(id => [id, CHANGE_STATUS.accepted] as const),
    ...plan.rejected.map(id => [id, CHANGE_STATUS.rejected] as const),
  ]);
  // One review stamps one time, however many records it touches.
  const reviewedAt = Date.now();
  // Review must not mutate cached ChangeSet records or partially publish steps.
  const snapshot = new ChangeSet(stampReviewed(changeSet.changes, statusOf, userID, reviewedAt));
  const changes = snapshot.changes.filter(change => statusOf.has(change.id));
  const placements = (decision: ReviewDecision) =>
    placementOrder(
      changes.filter(change =>
        change.dataTracked.operation === "move" && statusOf.get(change.id) === CHANGE_STATUS[decision]),
      decision,
    );
  const scratch = EditorState.create({ doc: createdTr.doc }).tr;
  try {
    const restored = placements("rejected");
    const restoreMapping = new Mapping();
    for (const change of restored) applyChanges(scratch, scratch.doc.type.schema, [change], snapshot, restoreMapping);
    // Transport cannot be mapped as a plain deletion, so identities are re-read
    // once a placement has been restored.
    const current = restored.length
      ? new ChangeSet(stampReviewed(
          findChanges(EditorState.create({ doc: scratch.doc })).changes, statusOf, userID, reviewedAt,
        ))
      : snapshot;
    const ordinaryIds = new Set(
      changes.filter(change => change.dataTracked.operation !== "move").map(change => change.id),
    );
    const remaining = current.changes.filter(change => ordinaryIds.has(change.id));
    const mapping = applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(change => !ChangeSet.isTextChange(change)), current);
    applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(ChangeSet.isTextChange), current, mapping);
    for (const change of placements("accepted")) applyChanges(scratch, scratch.doc.type.schema, [change], snapshot, mapping);
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
  return { status: "applied", ...decisions };
}
