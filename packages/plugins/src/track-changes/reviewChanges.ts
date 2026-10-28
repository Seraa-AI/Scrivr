import type { IBaseEditor } from "@scrivr/core";
import type { EditorState } from "@scrivr/core/pm";

import { setAction, TrackChangesAction } from "./actions";
import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { planChangeReview } from "./reviewPlan";
import type { ReviewDecisions, ReviewOutcome, ReviewPlan, ReviewPlanResult } from "./reviewPlan";

const subject = ({ accepted, rejected }: ReviewDecisions): ReviewDecisions => ({
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
    return { status: "blocked", ...subject(decisions), reason: "not-permitted" };
  }
  return planChangeReview(pluginState.changeSet, decisions);
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
  if (editor.readOnly) return { status: "blocked", ...subject(decisions), reason: "read-only" };
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
  const plan = planReview(editor, decisions);
  if (plan.status !== "ready") return plan;
  if (!editor) return { status: "unavailable", reason: "no-editor" };

  const lastReview = () => trackChangesPluginKey.getState(editor.getState())?.lastReview;
  const previous = lastReview();
  editor.applyTransaction(
    setAction(editor.getState().tr, TrackChangesAction.setChangeStatuses, subject(decisions)),
  );

  const outcome = lastReview();
  if (outcome && outcome !== previous) return outcome;
  // The engine records an outcome for every decision it is handed, so none
  // arriving means the decision never reached it — a host plugin filtered it out.
  console.error(
    "@scrivr/plugins track-changes: review published no outcome; the decision did not reach the engine",
    subject(plan),
  );
  return { status: "blocked", ...subject(plan), reason: "invalid-result" };
}
