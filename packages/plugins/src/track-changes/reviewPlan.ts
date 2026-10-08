import type { ChangeSet } from "./ChangeSet";
import type { TrackedChange } from "./types";

export type ChangeEffect = "create" | "delete" | "content" | "placement" | "presentation";
export function changeEffect(change: TrackedChange): ChangeEffect {
  if (change.type === "mark-change" || change.type === "node-attr-change") return "presentation";
  if (change.dataTracked.operation === "move") return "placement";
  if (change.dataTracked.operation === "insert") return "create";
  if (change.dataTracked.operation === "delete") return "delete";
  return "content";
}

export interface ReviewDependency {
  changeId: string;
  dependentIds: string[];
  relationship: "existence" | "placement";
}

export type ReviewDecision = "accepted" | "rejected";

/**
 * Why a decision cannot be carried out. Each reason needs its own words: only
 * `dependent-changes` can be resolved by deciding more, and offering that for
 * the others would propose work the reviewer never asked for.
 */
export type ReviewRefusal =
  | { reason: "dependent-changes"; dependencies: ReviewDependency[] }
  | { reason: "missing-changes"; missingIds: string[] }
  | { reason: "not-permitted" }
  | { reason: "invalid-result" };

type ReviewSubject = { decision: ReviewDecision; ids: string[] };

/** A preflight: what deciding these ids would take. Never an execution result. */
export type ReviewPlan =
  | ({ status: "ready" } & ReviewSubject)
  | ({ status: "blocked" } & ReviewSubject & ReviewRefusal);

/** What actually happened. A ready plan is a preview, not proof of this. */
export type ReviewOutcome =
  | ({ status: "applied" } & ReviewSubject)
  | ({ status: "blocked" } & ReviewSubject & ReviewRefusal);

/**
 * Pure, host-readable preflight. Containment discovers existence dependencies;
 * only explicit representation links authorize automatic review expansion.
 * Passing dependent IDs explicitly authorizes the compound decision.
 */
export function planChangeReview(
  changeSet: ChangeSet,
  decision: ReviewDecision,
  ids: readonly string[],
): ReviewPlan {
  const changes = changeSet.pending;
  const selected = new Set(ids);
  const missingIds = ids.filter(id => !changes.some(change => change.id === id));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const change of changes) {
      if (!selected.has(change.id)) continue;
      for (const related of changes) {
        if (selected.has(related.id)) continue;
        const representsCreation = related.dataTracked.creationId === change.id;
        const pairedMove = change.dataTracked.moveNodeId && related.dataTracked.moveNodeId === change.dataTracked.moveNodeId;
        const splitReference = related.dataTracked.operation === "reference" && related.dataTracked.referenceId === change.id;
        if (representsCreation || pairedMove || splitReference) {
          selected.add(related.id);
          expanded = true;
        }
      }
    }
  }
  const dependencies: ReviewDependency[] = [];
  for (const change of changes) {
    if (!selected.has(change.id)) continue;
    const effect = changeEffect(change);
    if (effect === "placement") {
      const dependentIds = decision === "rejected"
        ? changes.filter(other => !selected.has(other.id) && other.dataTracked.placementDependsOn?.includes(change.id)).map(other => other.id)
        : (change.dataTracked.placementDependsOn ?? []).filter(id => !selected.has(id) && changes.some(other => other.id === id));
      if (dependentIds.length) dependencies.push({ changeId: change.id, dependentIds, relationship: "placement" });
    }
    const removesContent = (effect === "create" && decision === "rejected") ||
      (effect === "delete" && decision === "accepted" && !change.dataTracked.moveNodeId);
    if (!removesContent) continue;
    const dependentIds = changes.filter(other => !selected.has(other.id) &&
      (other.dataTracked.dependsOn?.includes(change.id) ||
       (other.from < change.to && change.from < other.to &&
        !(other.type === "node-change" && other.from <= change.from && other.to >= change.to &&
          (other.from < change.from || other.to > change.to))))).map(other => other.id);
    if (dependentIds.length) dependencies.push({ changeId: change.id, dependentIds, relationship: "existence" });
  }
  const subject = { decision, ids: [...selected] };
  // A named change that is not pending is a different problem from one whose
  // decision would carry others, and must not be offered the same remedy.
  if (missingIds.length) return { status: "blocked", ...subject, reason: "missing-changes", missingIds };
  if (dependencies.length) return { status: "blocked", ...subject, reason: "dependent-changes", dependencies };
  return { status: "ready", ...subject };
}
