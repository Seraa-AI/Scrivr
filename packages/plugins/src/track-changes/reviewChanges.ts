import type { IBaseEditor } from "@scrivr/core";
import { EditorState } from "@scrivr/core/pm";

import { setAction, TrackChangesAction } from "./actions";
import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { settleMarks } from "./applyChanges";
import type { ChangeSet } from "./ChangeSet";
import { findChanges } from "./findChanges";
import { planChangeReview } from "./reviewPlan";
import { CHANGE_STATUS } from "./types";
import type { ReviewDecisions, ReviewOutcome, ReviewPlan, ReviewPlanResult } from "./reviewPlan";

const decisionsOf = ({ accepted, rejected }: ReviewDecisions): ReviewDecisions => ({
  accepted: [...accepted],
  rejected: [...rejected],
});

/**
 * Whether this state permits this decision, and what carrying it out would
 * take. The one place that answers both, so a command, a host preflight and the
 * plugin's own gate cannot drift apart on who may review what.
 *
 * A preview: it says nothing about whether the decision will succeed, so a
 * caller must replan before executing and must not dismiss its UI on this.
 */
export function planReviewIn(state: EditorState, decisions: ReviewDecisions): ReviewPlan {
  const pluginState = trackChangesPluginKey.getState(state);
  if (!pluginState?.canAcceptReject) {
    return { status: "blocked", ...decisionsOf(decisions), reason: "not-permitted" };
  }
  const plan = planChangeReview(pluginState.changeSet, decisions);
  if (plan.status !== "ready") return plan;
  const displaced = displacedBy(state, pluginState.changeSet, plan);
  return displaced.length > 0 ? { ...plan, rejected: [...plan.rejected, ...displaced] } : plan;
}

/**
 * The formatting suggestions a decision leaves no place for — held by an
 * accepted change, on a mark whose removal is accepted, under a rejected
 * suggestion that restores nothing — found by settling the marks as the review
 * will, so the plan names every change the review decides and none is dropped
 * undecided.
 */
function displacedBy(state: EditorState, changeSet: ChangeSet, plan: ReviewDecisions): string[] {
  const decided = new Set([...plan.accepted, ...plan.rejected]);
  const undecidedMarks = changeSet.pending.filter(change => change.type === "mark-change" && !decided.has(change.id));
  if (undecidedMarks.length === 0 || ![...decided].some(id => changeSet.pending.some(c => c.id === id && c.type === "mark-change"))) {
    return [];
  }
  const statuses = new Map<string, CHANGE_STATUS.accepted | CHANGE_STATUS.rejected>([
    ...plan.accepted.map((id): [string, CHANGE_STATUS.accepted] => [id, CHANGE_STATUS.accepted]),
    ...plan.rejected.map((id): [string, CHANGE_STATUS.rejected] => [id, CHANGE_STATUS.rejected]),
  ]);
  const scratch = state.tr;
  settleMarks(scratch, id => statuses.get(id));
  const left = new Set(findChanges(EditorState.create({ doc: scratch.doc })).pending.map(change => change.id));
  return undecidedMarks.filter(change => !left.has(change.id)).map(change => change.id);
}

/**
 * `planReviewIn` for callers holding an editor rather than a state — including
 * callers that may not have one yet. An absent editor is reported, never
 * returned as nothing, so a caller is not left reading absence as refusal.
 *
 * Read-only belongs to the editor rather than its state, so this is where it
 * is answered; the commands already refuse it on their own.
 */
export function planReview(
  editor: IBaseEditor | null | undefined,
  decisions: ReviewDecisions,
): ReviewPlanResult {
  if (!editor) return { status: "unavailable", reason: "no-editor" };
  if (editor.readOnly) return { status: "blocked", ...decisionsOf(decisions), reason: "read-only" };
  return planReviewIn(editor.getState(), decisions);
}

/**
 * Carries out the decision and reports what actually happened. The engine
 * decides on a private transaction and can still refuse after planning, so this
 * returns the executed outcome rather than the plan that preceded it — the one
 * thing a caller may act on when deciding whether the work is done.
 */
export function reviewChanges(
  editor: IBaseEditor | null | undefined,
  decisions: ReviewDecisions,
): ReviewOutcome {
  if (!editor) return { status: "unavailable", reason: "no-editor" };
  const plan = planReview(editor, decisions);
  if (plan.status !== "ready") return plan;

  const lastReview = () => trackChangesPluginKey.getState(editor.getState())?.lastReview;
  const previous = lastReview();
  editor.applyTransaction(
    setAction(editor.getState().tr, TrackChangesAction.setChangeStatuses, decisionsOf(decisions)),
  );

  const outcome = lastReview();
  if (outcome && outcome !== previous) return outcome;
  // The engine records an outcome for every decision it is handed, so none
  // arriving means the decision never reached it — a host plugin filtered it out.
  console.error(
    "@scrivr/plugins track-changes: review published no outcome; the decision did not reach the engine",
    decisionsOf(plan),
  );
  return { status: "blocked", ...decisionsOf(plan), reason: "invalid-result" };
}
