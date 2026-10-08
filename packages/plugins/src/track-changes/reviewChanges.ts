import type { IBaseEditor } from "@scrivr/core";

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
 * What deciding these changes would take, against the document as it stands.
 * A preview: it says nothing about whether the decision will succeed, so a
 * caller must replan before executing and must not dismiss its UI on this.
 */
export function planReview(
  editor: IBaseEditor,
  decision: ReviewDecision,
  ids: readonly string[],
): ReviewPlan {
  const pluginState = trackChangesPluginKey.getState(editor.getState());
  if (!pluginState) return { status: "blocked", ...subject(decision, ids), reason: "not-permitted" };
  if (!pluginState.canAcceptReject) {
    return { status: "blocked", ...subject(decision, ids), reason: "not-permitted" };
  }
  return planChangeReview(pluginState.changeSet, decision, ids);
}

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

  return (
    trackChangesPluginKey.getState(editor.getState())?.lastReview ?? {
      status: "blocked",
      ...subject(decision, plan.ids),
      reason: "invalid-result",
    }
  );
}
