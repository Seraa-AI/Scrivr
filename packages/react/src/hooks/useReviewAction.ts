/**
 * The one way this package decides tracked changes.
 *
 * Every Accept and Reject goes through here so a click always ends in one of
 * two places: the decision is carried out, or the reviewer is told what stopped
 * it. A refusal is held as state rather than thrown away, because the card that
 * was clicked is where the explanation belongs.
 *
 * Deciding dependent work is never automatic. The set is computed so it can be
 * shown, named behind a second confirmation, and replanned at the moment of
 * confirming — if it grew since the reviewer saw it, they see the wider set
 * before anything is decided, not after.
 */

import { useCallback, useMemo, useState } from "react";
import type { IBaseEditor } from "@scrivr/core";
import { planReview, reviewChanges, trackChangesPluginKey } from "@scrivr/plugins";
import type {
  ReviewDecision,
  ReviewOutcome,
  ReviewRefusal,
  TrackedChange,
} from "@scrivr/plugins";

export type ReviewRefusalState = {
  decision: ReviewDecision;
  /** What the reviewer asked to decide, before any dependent work. */
  ids: string[];
  refusal: ReviewRefusal;
  /** Dependent work, resolved to changes so it can be listed rather than counted. */
  dependents: TrackedChange[];
  /**
   * How far the reviewer has gone: told what stopped them, shown the dependent
   * work, or asked to decide it as a whole.
   */
  stage: "explain" | "listed" | "confirm";
  /** The set grew between being shown and being confirmed. */
  grew: boolean;
};

const dependentIdsOf = (refusal: ReviewRefusal) =>
  refusal.reason === "dependent-changes"
    ? [...new Set(refusal.dependencies.flatMap(d => d.dependentIds))]
    : [];

export function useReviewAction(editor: IBaseEditor | null) {
  const [refusal, setRefusal] = useState<ReviewRefusalState | null>(null);

  const resolve = useCallback(
    (ids: string[]): TrackedChange[] => {
      const all =
        (editor && trackChangesPluginKey.getState(editor.getState())?.changeSet.changes) ?? [];
      return ids
        .map(id => all.find(change => change.id === id))
        .filter((change): change is TrackedChange => !!change);
    },
    [editor],
  );

  const block = useCallback(
    (
      decision: ReviewDecision,
      ids: string[],
      blocked: ReviewRefusal,
      stage: ReviewRefusalState["stage"],
      seen: string[] = [],
    ) => {
      const dependentIds = dependentIdsOf(blocked);
      setRefusal({
        decision,
        ids,
        refusal: blocked,
        dependents: resolve(dependentIds),
        stage,
        // Only meaningful once the set has been shown; nothing has grown the
        // first time the reviewer is told about it.
        grew: stage !== "explain" && dependentIds.some(id => !seen.includes(id)),
      });
    },
    [resolve],
  );

  const settle = useCallback(
    (decision: ReviewDecision, ids: string[], outcome: ReviewOutcome) => {
      if (outcome.status === "blocked") block(decision, ids, outcome, "explain");
      else setRefusal(null);
      return outcome;
    },
    [block],
  );

  /** Attempt exactly what the reviewer asked for, and nothing more. */
  const review = useCallback(
    (decision: ReviewDecision, ids: string[]) => {
      if (!editor) return;
      return settle(decision, ids, reviewChanges(editor, decision, ids));
    },
    [editor, settle],
  );

  /** Show the dependent work in place. Shows it; authorizes nothing. */
  const listDependents = useCallback(() => {
    setRefusal(current =>
      current?.stage === "explain" ? { ...current, stage: "listed" } : current,
    );
  }, []);

  /**
   * Replan the compound decision against the document as it stands. Both the
   * confirmation and the decision itself go through here, so neither can act on
   * a set the reviewer has not been shown.
   */
  const replan = useCallback(() => {
    if (!editor || !refusal) return null;
    const seen = refusal.dependents.map(c => c.id);
    const asked = [...new Set([...refusal.ids, ...seen])];
    const plan = planReview(editor, refusal.decision, asked);
    if (plan.status === "blocked") {
      block(refusal.decision, refusal.ids, plan, "confirm", seen);
      return null;
    }
    return { asked, decision: refusal.decision };
  }, [editor, refusal, block]);

  /** Open the confirmation for the compound decision, listing what it covers. */
  const requestConfirm = useCallback(() => {
    if (!replan() || !refusal) return;
    setRefusal({ ...refusal, stage: "confirm", grew: false });
  }, [replan, refusal]);

  /** Send the compound decision, which `replan` has just re-checked. */
  const confirm = useCallback(() => {
    const ready = replan();
    if (!ready || !editor) return;
    return settle(
      ready.decision,
      ready.asked,
      reviewChanges(editor, ready.decision, ready.asked),
    );
  }, [replan, editor, settle]);

  /**
   * Keep one change and discard the others — a conflict resolution, which is one
   * decision even though it is two statuses. Both halves are planned before
   * either runs, so a refusal cannot arrive with the first half already
   * committed and no way back.
   */
  const resolveConflict = useCallback(
    (keepId: string, discardIds: string[]) => {
      if (!editor) return;
      const keep = planReview(editor, "accepted", [keepId]);
      if (keep.status === "blocked") return settle("accepted", [keepId], keep);
      const discard = discardIds.length
        ? planReview(editor, "rejected", discardIds)
        : null;
      if (discard?.status === "blocked") return settle("rejected", discardIds, discard);

      const applied = reviewChanges(editor, "accepted", [keepId]);
      if (applied.status !== "applied") return settle("accepted", [keepId], applied);
      if (!discardIds.length) return applied;
      return settle("rejected", discardIds, reviewChanges(editor, "rejected", discardIds));
    },
    [editor, settle],
  );

  const dismiss = useCallback(() => setRefusal(null), []);

  return useMemo(
    () => ({
      review,
      refusal,
      listDependents,
      requestConfirm,
      confirm,
      resolveConflict,
      dismiss,
    }),
    [review, refusal, listDependents, requestConfirm, confirm, resolveConflict, dismiss],
  );
}

export type ReviewAction = ReturnType<typeof useReviewAction>;
