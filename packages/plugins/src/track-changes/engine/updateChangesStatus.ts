import { EditorState, Mapping, type Node, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_STATUS, type IncompleteChange, type TrackedChange } from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { stepRange } from "./transactionProcessing";
import { applyChanges } from "../applyChanges";
import { planChangeReview } from "../reviewPlan";
import type { ReviewOutcome } from "../reviewPlan";

/** The node that now holds this span, and the nodes the span covers. */
function checkAround(doc: Node, from: number, to: number) {
  const $from = doc.resolve(from);
  // A container can be left invalid by what was taken out of it, not only by
  // what remains inside the span.
  if ($from.depth > 0) $from.parent.check();
  if (from === to) {
    // Nothing spans a join site; the nodes it joined sit either side of it.
    $from.nodeBefore?.check();
    $from.nodeAfter?.check();
    return;
  }
  doc.nodesBetween(from, to, node => {
    node.check();
    return false;
  });
}

/**
 * Validates what this review rewrote rather than the whole document. A document
 * can hold invalid content no review touched — written by another author, or by
 * an older defect — and failing on that would make every decision in the
 * document permanently unresolvable.
 *
 * The spans come from the steps, not their position maps: review does most of
 * its work with marks, whose maps are empty, so a map walk would have validated
 * nothing for accepting an insertion or a deletion.
 */
function checkRewritten(scratch: Transaction) {
  const doc = scratch.doc;
  if (!doc.type.validContent(doc.content)) {
    throw new RangeError(`Invalid content for node ${doc.type.name}`);
  }
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
  scratch.steps.forEach((step, i) => {
    const range = stepRange(step);
    if (!range) return;
    const forward = scratch.mapping.slice(i + 1);
    const from = clamp(forward.map(range.from, -1));
    checkAround(doc, from, Math.max(from, clamp(forward.map(range.to, 1))));
  });
}

/**
 * The same records, with the reviewed ones stamped. Returns the unvalidated
 * shape on purpose: spreading a change widens its discriminant, and `ChangeSet`
 * is the one place records are validated back into changes.
 */
function stampReviewed(
  changes: readonly TrackedChange[],
  selected: ReadonlySet<string>,
  status: CHANGE_STATUS,
  userID: string,
  reviewedAt: number,
): IncompleteChange[] {
  return changes.map(change => ({
    ...change,
    dataTracked: selected.has(change.id)
      ? { ...change.dataTracked, status, reviewedByID: userID, statusUpdateAt: reviewedAt }
      : { ...change.dataTracked },
  }));
}

/** Plan first, evaluate on a private transaction, then publish the whole result. */
export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  ids: string[],
  status: CHANGE_STATUS,
  userID: string,
): ReviewOutcome | undefined {
  if (status === CHANGE_STATUS.pending) return;
  const decision = status === CHANGE_STATUS.accepted ? "accepted" : "rejected";
  const plan = planChangeReview(changeSet, decision, ids);
  if (plan.status === "blocked") return plan;
  const selected = new Set(plan.ids);
  // One review stamps one time, however many records it touches.
  const reviewedAt = Date.now();
  // Review must not mutate cached ChangeSet records or partially publish steps.
  const snapshot = new ChangeSet(
    stampReviewed(changeSet.changes, selected, status, userID, reviewedAt),
  );
  const changes = snapshot.changes.filter(change => selected.has(change.id));
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
      ? new ChangeSet(
          stampReviewed(
            findChanges(EditorState.create({ doc: scratch.doc })).changes,
            selected,
            status,
            userID,
            reviewedAt,
          ),
        )
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
    return { decision, ids: plan.ids, status: "blocked", reason: "invalid-result" };
  }
  for (const step of scratch.steps) createdTr.step(step);
  return { decision, ids: plan.ids, status: "applied" };
}
