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

/**
 * There is no editor to decide against yet, or no longer. Lifecycle, not
 * policy: a host disables its review controls while this is the answer rather
 * than telling a reviewer they were refused.
 */
export type ReviewUnavailable = { status: "unavailable"; reason: "no-editor" };

/** A preflight: what deciding these ids would take. Never an execution result. */
export type ReviewPlan =
  | ({ status: "ready" } & ReviewSubject)
  | ({ status: "blocked" } & ReviewSubject & ReviewRefusal);

/**
 * A plan, or nothing to plan against. Only the forms that take an editor can
 * answer `unavailable`; given a change set there is always a plan.
 */
export type ReviewPlanResult = ReviewPlan | ReviewUnavailable;

/** What actually happened. A ready plan is a preview, not proof of this. */
export type ReviewOutcome =
  | ({ status: "applied" } & ReviewSubject)
  | ({ status: "blocked" } & ReviewSubject & ReviewRefusal)
  | ReviewUnavailable;

/** Two changes cover some of the same content. */
const overlaps = (a: TrackedChange, b: TrackedChange) => a.from < b.to && b.from < a.to;

/**
 * `outer` is a node-change wrapping `inner` with room to spare — an ancestor,
 * not a dependent. Deciding the inner change does not decide the container it
 * happens to sit in.
 */
const strictlyContains = (outer: TrackedChange, inner: TrackedChange) =>
  outer.type === "node-change" &&
  outer.from <= inner.from &&
  outer.to >= inner.to &&
  (outer.from < inner.from || outer.to > inner.to);

/** `related` only exists as part of `change`, so reviewing one reviews both. */
const representsCreation = (related: TrackedChange, change: TrackedChange) =>
  related.dataTracked.creationId === change.id;

/** Two halves of one transport: the copy and the shadow it left behind. */
const pairedMove = (related: TrackedChange, change: TrackedChange) =>
  !!change.dataTracked.moveNodeId &&
  related.dataTracked.moveNodeId === change.dataTracked.moveNodeId;

/** The record pointing back at what a split was split from. */
const splitReference = (related: TrackedChange, change: TrackedChange) =>
  related.dataTracked.operation === "reference" &&
  related.dataTracked.referenceId === change.id;

/** Would carrying out this decision take the content away? */
const removesContent = (change: TrackedChange, decision: ReviewDecision) => {
  const effect = changeEffect(change);
  if (effect === "create") return decision === "rejected";
  if (effect === "delete") return decision === "accepted" && !change.dataTracked.moveNodeId;
  return false;
};

/**
 * Work that would go with the content: either it said so, or it sits inside the
 * span being removed. A container merely enclosing the change is excluded — it
 * is an ancestor, and deciding its child is not a decision about it.
 */
const existenceDependents = (
  change: TrackedChange,
  changes: readonly TrackedChange[],
  selected: ReadonlySet<string>,
) =>
  changes.filter(
    other =>
      !selected.has(other.id) &&
      (other.dataTracked.dependsOn?.includes(change.id) ||
        (overlaps(other, change) && !strictlyContains(other, change))),
  );

/**
 * Placements this decision cannot be taken without. Rejecting a move needs the
 * later moves built on it decided first; accepting one needs the earlier moves
 * it was based on.
 */
const placementDependents = (
  change: TrackedChange,
  changes: readonly TrackedChange[],
  selected: ReadonlySet<string>,
  decision: ReviewDecision,
) =>
  decision === "rejected"
    ? changes
        .filter(
          other =>
            !selected.has(other.id) &&
            other.dataTracked.placementDependsOn?.includes(change.id),
        )
        .map(other => other.id)
    : (change.dataTracked.placementDependsOn ?? []).filter(
        id => !selected.has(id) && changes.some(other => other.id === id),
      );

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
        // Representation links, not overlaps: these are the same act recorded
        // in more than one place, so reviewing it covers all of them.
        if (
          representsCreation(related, change) ||
          pairedMove(related, change) ||
          splitReference(related, change)
        ) {
          selected.add(related.id);
          expanded = true;
        }
      }
    }
  }
  const dependencies: ReviewDependency[] = [];
  for (const change of changes) {
    if (!selected.has(change.id)) continue;
    if (changeEffect(change) === "placement") {
      const placements = placementDependents(change, changes, selected, decision);
      if (placements.length) {
        dependencies.push({ changeId: change.id, dependentIds: placements, relationship: "placement" });
      }
    }
    if (!removesContent(change, decision)) continue;
    const dependentIds = existenceDependents(change, changes, selected).map(other => other.id);
    if (dependentIds.length) {
      dependencies.push({ changeId: change.id, dependentIds, relationship: "existence" });
    }
  }
  const subject = { decision, ids: [...selected] };
  // A named change that is not pending is a different problem from one whose
  // decision would carry others, and must not be offered the same remedy.
  if (missingIds.length) return { status: "blocked", ...subject, reason: "missing-changes", missingIds };
  if (dependencies.length) return { status: "blocked", ...subject, reason: "dependent-changes", dependencies };
  return { status: "ready", ...subject };
}
