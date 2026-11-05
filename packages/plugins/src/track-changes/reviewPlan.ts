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

/** A preflight: what deciding these changes would take. `ready` is never an execution result. */
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

/** `part` only exists as part of the insertion `whole` created. */
const representsCreation = (part: TrackedChange, whole: TrackedChange) =>
  part.dataTracked.creationId === whole.id;

/** `part` records some of the deletion `whole` made in one gesture. */
const representsDeletion = (part: TrackedChange, whole: TrackedChange) =>
  part.dataTracked.deletionId === whole.id;

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
const splitReference = (reference: TrackedChange, split: TrackedChange) =>
  reference.dataTracked.operation === "reference" &&
  reference.dataTracked.referenceId === split.id;

/**
 * Two records of one act. Whichever a reviewer reaches, they are deciding the
 * act, so the relation holds in both directions.
 */
const sameAct = (a: TrackedChange, b: TrackedChange) =>
  representsCreation(a, b) || representsCreation(b, a) ||
  representsDeletion(a, b) || representsDeletion(b, a) ||
  samePieces(a, b) ||
  pairedMove(a, b) ||
  splitReference(a, b) || splitReference(b, a);

/** A record that is secondary within its act: others name the act, this one follows it. */
const isPartOfAct = ({ id, dataTracked }: TrackedChange) =>
  dataTracked.operation === "reference" ||
  !!dataTracked.continuesId ||
  (dataTracked.operation === "delete" && !!dataTracked.moveNodeId) ||
  (!!dataTracked.creationId && dataTracked.creationId !== id) ||
  (!!dataTracked.deletionId && dataTracked.deletionId !== id);

/**
 * One thing someone did, however many records it took to represent. `primary`
 * is the record to show and to name when deciding it; deciding any record of an
 * act decides the whole act.
 */
export interface ChangeAct {
  primary: TrackedChange;
  /** Every record of the act, in the order given. */
  records: TrackedChange[];
}

/** Groups changes into acts. The one answer to "what does one decision cover?" */
export function changeActs(changes: readonly TrackedChange[]): ChangeAct[] {
  const remaining = new Set(changes);
  const acts: ChangeAct[] = [];
  for (const change of changes) {
    if (!remaining.delete(change)) continue;
    const records = [change];
    for (const record of records) {
      for (const other of remaining) {
        if (!sameAct(record, other)) continue;
        remaining.delete(other);
        records.push(other);
      }
    }
    const inOrder = changes.filter(c => records.includes(c));
    acts.push({ primary: inOrder.find(c => !isPartOfAct(c)) ?? inOrder[0]!, records: inOrder });
  }
  return acts;
}

const isMoveShadow = ({ dataTracked }: TrackedChange) =>
  dataTracked.operation === "delete" && !!dataTracked.moveNodeId;

/**
 * Would carrying out this decision take the content away? A move's shadow is
 * consumed in either direction: accepting removes it, rejecting replaces it
 * with the live copy. Work subsequently written on the shadow does not travel
 * with that copy, so both decisions require its review.
 */
const removesContent = (change: TrackedChange, decision: ReviewDecision, changes: readonly TrackedChange[]) => {
  const effect = changeEffect(change);
  // Rejoining a shadow's split-off half hands its content to the shadow, which
  // is then consumed.
  if (change.dataTracked.operation === "node_split" && decision === "rejected") {
    return changes.some(reference =>
      splitReference(reference, change) &&
      changes.some(shadow => isMoveShadow(shadow) && shadow.from === reference.from));
  }
  if (effect === "create") return decision === "rejected";
  if (effect === "delete") return !!change.dataTracked.moveNodeId || decision === "accepted";
  return false;
};

/**
 * Work that would go with the content: either it said so, or it overlaps the
 * span being removed. A container merely enclosing the change is excluded — it
 * is an ancestor, and deciding its child is not a decision about it.
 */
/**
 * Rejecting transport restores the prior placements stored on the shadow's root.
 * Those identities survive replacement; its content does not. They remain
 * placement dependencies, not existence dependencies.
 */
const restoredPriorPlacement = (other: TrackedChange, change: TrackedChange, decision: ReviewDecision) =>
  decision === "rejected" &&
  isMoveShadow(change) &&
  other.dataTracked.operation === "move" &&
  other.from === change.from &&
  other.to === change.to;

const existenceDependents = (
  change: TrackedChange,
  changes: readonly TrackedChange[],
  selected: ReadonlySet<string>,
  decision: ReviewDecision,
) =>
  changes.filter(
    other =>
      !selected.has(other.id) &&
      !restoredPriorPlacement(other, change, decision) &&
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
        if (!sameAct(related, change)) continue;
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
    const placements = changeEffect(change) === "placement"
      ? placementDependents(change, changes, selected, decision)
      : decision === "rejected" && change.dataTracked.operation === "node_split"
        // The split-off half cannot rejoin its block from wherever it was moved to.
        ? changes.filter(other => changeEffect(other) === "placement" && other.from === change.from && !selected.has(other.id)).map(other => other.id)
        : [];
    if (placements.length) {
      dependencies.push({ changeId: change.id, dependentIds: placements, relationship: "placement" });
    }
    if (!removesContent(change, decision, changes)) continue;
    const dependentIds = existenceDependents(change, changes, selected, decision).map(other => other.id);
    if (dependentIds.length) {
      dependencies.push({ changeId: change.id, dependentIds, relationship: "existence" });
    }
  }
  const decided: ReviewDecisions = { accepted: [], rejected: [] };
  for (const [id, decision] of decisionOf) {
    if (!contradictory.has(id)) decided[decision].push(id);
  }
  // A change asked for both ways, a change that is not pending, and one whose
  // decision would carry others are different problems, and must not be
  // offered the same remedy.
  if (contradictory.size) {
    return { status: "blocked", ...decided, reason: "contradictory-decisions", contradictoryIds: [...contradictory] };
  }
  if (missingIds.length) return { status: "blocked", ...decided, reason: "missing-changes", missingIds };
  if (dependencies.length) return { status: "blocked", ...decided, reason: "dependent-changes", dependencies };
  return { status: "ready", ...decided };
}
