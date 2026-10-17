import type { ChangeSet } from "./ChangeSet";
import type { TrackedChange } from "./types";

/** What deciding a change does to the document, which settles what it can take with it. */
export type ChangeEffect = "create" | "delete" | "content" | "placement" | "presentation";

/** Classifies a change by its effect — for a host grouping or wording review choices. */
export function changeEffect(change: TrackedChange): ChangeEffect {
  if (change.type === "mark-change" || change.type === "node-attr-change") return "presentation";
  if (change.dataTracked.operation === "move") return "placement";
  if (change.dataTracked.operation === "insert") return "create";
  if (change.dataTracked.operation === "delete") return "delete";
  return "content";
}

/**
 * Changes that deciding `changeId` would also decide. `existence`: the decision
 * removes content they live on. `placement`: they build on, or are built on by,
 * the move being decided.
 */
export interface ReviewDependency {
  changeId: string;
  dependentIds: string[];
  relationship: "existence" | "placement";
}

/** The two ways a pending change can be decided. */
export type ReviewDecision = "accepted" | "rejected";

/**
 * Which changes to accept and which to reject, carried out as one decision. A
 * conflict resolution is the case that needs both sides at once: keeping one
 * author's change is accepting it and rejecting the others together.
 */
export interface ReviewDecisions {
  accepted: string[];
  rejected: string[];
}

/**
 * Why a decision cannot be carried out. Each reason needs its own words: only
 * `dependent-changes` can be resolved by deciding more, and offering that for
 * the others would propose work the reviewer never asked for.
 */
export type ReviewRefusal =
  | { reason: "dependent-changes"; dependencies: ReviewDependency[] }
  | { reason: "missing-changes"; missingIds: string[] }
  | { reason: "contradictory-decisions"; contradictoryIds: string[] }
  | { reason: "not-permitted" }
  | { reason: "read-only" }
  | { reason: "invalid-result" };

/**
 * There is no editor to decide against yet, or no longer. Lifecycle, not
 * policy: a host disables its review controls while this is the answer rather
 * than telling a reviewer they were refused.
 */
export type ReviewUnavailable = { status: "unavailable"; reason: "no-editor" };

/** A preflight: what deciding these changes would take. Never an execution result. */
export type ReviewPlan =
  | ({ status: "ready" } & ReviewDecisions)
  | ({ status: "blocked" } & ReviewDecisions & ReviewRefusal);

/**
 * A plan, or nothing to plan against. Only the forms that take an editor can
 * answer `unavailable`; given a change set there is always a plan.
 */
export type ReviewPlanResult = ReviewPlan | ReviewUnavailable;

/** What actually happened. A ready plan is a preview, not proof of this. */
export type ReviewOutcome =
  | ({ status: "applied" } & ReviewDecisions)
  | ({ status: "blocked" } & ReviewDecisions & ReviewRefusal)
  | ReviewUnavailable;

/** Two changes cover some of the same content. */
const overlaps = (a: TrackedChange, b: TrackedChange) => a.from < b.to && b.from < a.to;

/** Recorded on a node rather than on text: it covers the node's whole span. */
const onNode = (change: TrackedChange) => change.type !== "text-change" && change.type !== "mark-change";

/**
 * `outer` is recorded on a node wrapping `inner` with room to spare — an
 * ancestor, not a dependent. Deciding the inner change does not decide the
 * container it happens to sit in, whatever was recorded about that container.
 */
const strictlyContains = (outer: TrackedChange, inner: TrackedChange) =>
  onNode(outer) &&
  outer.from <= inner.from &&
  outer.to >= inner.to &&
  (outer.from < inner.from || outer.to > inner.to);

/** `related` only exists as part of `change`, so reviewing one reviews both. */
const representsCreation = (related: TrackedChange, change: TrackedChange) =>
  related.dataTracked.creationId === change.id;

/** `related` records part of the deletion `change` made in one gesture. */
const representsDeletion = (related: TrackedChange, change: TrackedChange) =>
  related.dataTracked.deletionId === change.id;

/** Pieces of one record that later work split apart. */
const samePieces = (related: TrackedChange, change: TrackedChange) => {
  const root = (c: TrackedChange) => c.dataTracked.continuesId ?? c.id;
  return (!!related.dataTracked.continuesId || !!change.dataTracked.continuesId) && root(related) === root(change);
};

/** Two halves of one transport: the copy and the shadow it left behind. */
const pairedMove = (related: TrackedChange, change: TrackedChange) =>
  !!change.dataTracked.moveNodeId &&
  related.dataTracked.moveNodeId === change.dataTracked.moveNodeId;

/** The record pointing back at what a split was split from. */
const splitReference = (related: TrackedChange, change: TrackedChange) =>
  related.dataTracked.operation === "reference" &&
  related.dataTracked.referenceId === change.id;

/**
 * Would carrying out this decision take the content away? Accepting a move
 * removes its shadow too: the moved content travelled with the copy, but work
 * done on the shadow afterwards did not.
 */
const removesContent = (change: TrackedChange, decision: ReviewDecision) => {
  const effect = changeEffect(change);
  if (effect === "create") return decision === "rejected";
  if (effect === "delete") return decision === "accepted";
  return false;
};

/**
 * Work that would go with the content: either it said so, or it overlaps the
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
 * Pure, host-readable preflight. Overlap discovers existence dependencies; only
 * explicit representation links authorize automatic review expansion, and the
 * linked record takes the decision of the change it belongs to. Naming a change
 * on either side authorizes deciding it, so it is never reported as a
 * dependent of another change in the same decision.
 */
export function planChangeReview(changeSet: ChangeSet, decisions: ReviewDecisions): ReviewPlan {
  const changes = changeSet.pending;
  const decisionOf = new Map<string, ReviewDecision>();
  const contradictory = new Set<string>();
  const decide = (id: string, decision: ReviewDecision) => {
    const existing = decisionOf.get(id);
    if (existing && existing !== decision) contradictory.add(id);
    else decisionOf.set(id, decision);
  };
  decisions.accepted.forEach(id => decide(id, "accepted"));
  decisions.rejected.forEach(id => decide(id, "rejected"));
  const missingIds = [...decisionOf.keys()].filter(id => !changes.some(change => change.id === id));

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const change of changes) {
      const decision = decisionOf.get(change.id);
      if (!decision) continue;
      for (const related of changes) {
        // Representation links, not overlaps: these are the same act recorded
        // in more than one place, so reviewing it covers all of them.
        if (
          !representsCreation(related, change) &&
          !representsDeletion(related, change) &&
          !samePieces(related, change) &&
          !pairedMove(related, change) &&
          !splitReference(related, change)
        ) continue;
        if (!decisionOf.has(related.id)) expanded = true;
        decide(related.id, decision);
      }
    }
  }

  const selected = new Set(decisionOf.keys());
  const dependencies: ReviewDependency[] = [];
  for (const change of changes) {
    const decision = decisionOf.get(change.id);
    if (!decision) continue;
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
  const subject: ReviewDecisions = { accepted: [], rejected: [] };
  for (const [id, decision] of decisionOf) {
    if (!contradictory.has(id)) subject[decision].push(id);
  }
  // A change asked for both ways, a change that is not pending, and one whose
  // decision would carry others are different problems, and must not be
  // offered the same remedy.
  if (contradictory.size) {
    return { status: "blocked", ...subject, reason: "contradictory-decisions", contradictoryIds: [...contradictory] };
  }
  if (missingIds.length) return { status: "blocked", ...subject, reason: "missing-changes", missingIds };
  if (dependencies.length) return { status: "blocked", ...subject, reason: "dependent-changes", dependencies };
  return { status: "ready", ...subject };
}
