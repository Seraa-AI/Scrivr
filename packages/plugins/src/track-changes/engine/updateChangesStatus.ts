import { EditorState, Mapping, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_STATUS, type TrackedChange } from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { applyChanges } from "../applyChanges";
import { planChangeReview } from "../reviewPlan";

/**
 * Validates what this review rewrote rather than the whole document. A document
 * can hold invalid content no review touched — written by another author, or by
 * an older defect — and failing on that would make every decision in the
 * document permanently unresolvable.
 */
function checkRewritten(scratch: Transaction) {
  const doc = scratch.doc;
  if (!doc.type.validContent(doc.content)) {
    throw new RangeError(`Invalid content for node ${doc.type.name}`);
  }
  scratch.mapping.maps.forEach((map, i) => {
    const forward = scratch.mapping.slice(i + 1);
    map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      const from = Math.max(0, Math.min(forward.map(newFrom, -1), doc.content.size));
      const to = Math.max(from, Math.min(forward.map(newTo, 1), doc.content.size));
      doc.nodesBetween(from, to, node => {
        node.check();
        return false;
      });
    });
  });
}

/** Plan first, evaluate on a private transaction, then publish the whole result. */
export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  ids: string[],
  status: CHANGE_STATUS,
  userID: string,
) {
  if (status === CHANGE_STATUS.pending) return;
  const plan = planChangeReview(changeSet, status, ids);
  if (plan.status === "blocked") return plan;
  const selected = new Set(plan.ids);
  // One review stamps one time, however many records it touches.
  const reviewedAt = Date.now();
  // Review must not mutate cached ChangeSet records or partially publish steps.
  const reviewed = changeSet.changes.map(change => ({ ...change,
    dataTracked: selected.has(change.id)
      ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: reviewedAt }
      : { ...change.dataTracked },
  })) as TrackedChange[];
  const snapshot = new ChangeSet(reviewed);
  const changes = reviewed.filter(change => selected.has(change.id));
  const scratch = EditorState.create({ doc: createdTr.doc }).tr;
  try {
    const placements = changes.filter(change => change.dataTracked.operation === "move");
    const ordinary = changes.filter(change => change.dataTracked.operation !== "move");
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
    if (status === CHANGE_STATUS.rejected) ordered.reverse();
    // Restore placement before destructive review of a dependent creation.
    // Re-read identities afterward: transport cannot be mapped as a plain deletion.
    if (status === CHANGE_STATUS.rejected) {
      const placementMapping = new Mapping();
      for (const change of ordered) applyChanges(scratch, scratch.doc.type.schema, [change], snapshot, placementMapping);
    }
    const current = status === CHANGE_STATUS.rejected
      ? new ChangeSet(findChanges(EditorState.create({ doc: scratch.doc })).changes.map(change => ({
          ...change,
          dataTracked: selected.has(change.id)
            ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: reviewedAt }
            : { ...change.dataTracked },
        })) as TrackedChange[])
      : snapshot;
    const ordinaryIds = new Set(ordinary.map(change => change.id));
    const remaining = current.changes.filter(change => ordinaryIds.has(change.id));
    const mapping = applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(change => !ChangeSet.isTextChange(change)), current);
    applyChanges(scratch, scratch.doc.type.schema,
      remaining.filter(ChangeSet.isTextChange), current, mapping);
    if (status === CHANGE_STATUS.accepted) {
      for (const change of ordered) applyChanges(scratch, scratch.doc.type.schema, [change], snapshot, mapping);
    }
    dropOrphanChanges(scratch);
    checkRewritten(scratch);
  } catch (error) {
    // Nothing is published, and this is logged rather than only reported: an
    // engine invariant broke here, which is not a decision the reviewer made.
    console.error(
      "@scrivr/plugins track-changes: review produced an invalid result, no changes applied",
      error,
    );
    return { ...plan, status: "blocked" as const, failure: "invalid-review-result" as const };
  }
  for (const step of scratch.steps) createdTr.step(step);
  return plan;
}
