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
  ReviewPlan,
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
  /** "explain" is the notice on the card; "confirm" is the compound decision. */
  stage: "explain" | "confirm";
  /** The reviewer asked to see the dependent work without committing to it. */
  listed: boolean;
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
        listed: stage === "confirm",
        grew: dependentIds.some(id => !seen.includes(id)),
      });
    },
    [resolve],
  );

  const settle = useCallback(
    (decision: ReviewDecision, ids: string[], outcome: ReviewOutcome | ReviewPlan) => {
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
    setRefusal(current => (current ? { ...current, listed: true } : current));
  }, []);

  /** Open the confirmation for the compound decision, listing what it covers. */
  const requestConfirm = useCallback(() => {
    if (!editor || !refusal) return;
    const seen = refusal.dependents.map(c => c.id);
    const asked = [...new Set([...refusal.ids, ...seen])];
    const replanned = planReview(editor, refusal.decision, asked);
    if (replanned.status === "blocked") {
      return block(refusal.decision, refusal.ids, replanned, "confirm", seen);
    }
    setRefusal({ ...refusal, stage: "confirm", listed: true, grew: false });
  }, [editor, refusal, block]);

  /**
   * Send the compound decision — after replanning, because the document may
   * have moved on since the confirmation was opened. A wider set is shown
   * rather than slipped in behind the confirmation already given.
   */
  const confirm = useCallback(() => {
    if (!editor || !refusal) return;
    const seen = refusal.dependents.map(c => c.id);
    const asked = [...new Set([...refusal.ids, ...seen])];
    const replanned = planReview(editor, refusal.decision, asked);
    if (replanned.status === "blocked") {
      return block(refusal.decision, refusal.ids, replanned, "confirm", seen);
    }
    return settle(refusal.decision, asked, reviewChanges(editor, refusal.decision, asked));
  }, [editor, refusal, block, settle]);

  const dismiss = useCallback(() => setRefusal(null), []);

  return useMemo(
    () => ({ review, refusal, listDependents, requestConfirm, confirm, dismiss }),
    [review, refusal, listDependents, requestConfirm, confirm, dismiss],
  );
}

export type ReviewAction = ReturnType<typeof useReviewAction>;
