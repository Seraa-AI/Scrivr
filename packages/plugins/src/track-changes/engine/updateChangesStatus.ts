import { EditorState, Mapping, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_STATUS, type TrackedChange } from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { applyChanges } from "../applyChanges";
import { planChangeReview } from "../reviewPlan";

/** Plan first, evaluate on a private transaction, then publish the whole result. */
export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  ids: string[],
  status: CHANGE_STATUS,
  userID: string,
  _oldState: EditorState,
) {
  if (status === CHANGE_STATUS.pending) return;
  const plan = planChangeReview(changeSet, status, ids);
  if (plan.status === "blocked") return plan;
  const selected = new Set(plan.ids);
  // Review must not mutate cached ChangeSet records or partially publish steps.
  const reviewed = changeSet.changes.map(change => ({ ...change,
    dataTracked: selected.has(change.id)
      ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: Date.now() }
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
            ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: Date.now() }
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
    scratch.doc.check();
  } catch {
    return { ...plan, status: "blocked" as const, failure: "invalid-review-result" as const };
  }
  for (const step of scratch.steps) createdTr.step(step);
  return plan;
}
