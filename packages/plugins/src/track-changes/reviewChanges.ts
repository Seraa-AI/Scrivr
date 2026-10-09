import type { IBaseEditor } from "@scrivr/core";
import type { EditorState } from "@scrivr/core/pm";

import { setAction, TrackChangesAction } from "./actions";
import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { planChangeReview } from "./reviewPlan";
import type { ReviewDecision, ReviewOutcome, ReviewPlan } from "./reviewPlan";
import { CHANGE_STATUS } from "./types";

const subject = (decision: ReviewDecision, ids: readonly string[]) => ({
  decision,
  ids: [...ids],
});

/**
 * Whether this state permits this decision, and what carrying it out would
 * take. The one place that answers both, so a command, a host preflight and the
 * plugin's own gate cannot drift apart on who may review what.
 *
 * A preview: it says nothing about whether the decision will succeed, so a
 * caller must replan before executing and must not dismiss its UI on this.
 */
export function planReviewIn(
  state: EditorState,
  decision: ReviewDecision,
  ids: readonly string[],
): ReviewPlan {
  const pluginState = trackChangesPluginKey.getState(state);
  if (!pluginState?.canAcceptReject) {
    return { status: "blocked", ...subject(decision, ids), reason: "not-permitted" };
  }
  return planChangeReview(pluginState.changeSet, decision, ids);
}

/** `planReviewIn` for callers holding an editor rather than a state. */
export const planReview = (
  editor: IBaseEditor,
  decision: ReviewDecision,
  ids: readonly string[],
) => planReviewIn(editor.getState(), decision, ids);

/**
 * Carries out the decision and reports what actually happened. The engine
 * decides on a private transaction and can still refuse after planning, so this
 * returns the executed outcome rather than the plan that preceded it — the one
 * thing a caller may act on when deciding whether the work is done.
 */
export function reviewChanges(
  editor: IBaseEditor,
  decision: ReviewDecision,
  ids: readonly string[],
): ReviewOutcome {
  const plan = planReview(editor, decision, ids);
  if (plan.status === "blocked") return plan;

  const state = editor.getState();
  editor.applyTransaction(
    setAction(state.tr, TrackChangesAction.setChangeStatuses, {
      status: decision === "accepted" ? CHANGE_STATUS.accepted : CHANGE_STATUS.rejected,
      ids: [...ids],
    }),
  );

  const outcome = trackChangesPluginKey.getState(editor.getState())?.lastReview;
  if (outcome) return outcome;
  // The engine records an outcome for every decision it is handed, so reaching
  // here means it did not. Say so rather than reporting a failure that may not
  // have happened.
  console.error(
    "@scrivr/plugins track-changes: review published no outcome; the document may have changed",
    { decision, ids: plan.ids },
  );
  return { status: "blocked", ...subject(decision, plan.ids), reason: "invalid-result" };
}
