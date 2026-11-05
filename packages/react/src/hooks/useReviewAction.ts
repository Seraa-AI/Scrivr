import { useCallback, useMemo, useState } from "react";
import type { IBaseEditor } from "@scrivr/core";
import { planReview, reviewChanges, trackChangesPluginKey } from "@scrivr/plugins";
import type {
  ReviewDecision,
  ReviewDecisions,
  ReviewOutcome,
  ReviewPlanResult,
  ReviewRefusal,
  TrackedChange,
} from "@scrivr/plugins";

type Blocked = Extract<ReviewOutcome, { status: "blocked" }>;

/** A refusal held for the surface that was clicked, and how far the reviewer has taken it. */
export type ReviewRefusalState = {
  /** What the reviewer asked to decide, before any dependent work. */
  request: ReviewDecisions;
  why: ReviewRefusal;
  /**
   * The decision that would cover the request and its dependent work. Each
   * dependent takes the decision of the change it depends on.
   */
  compound: ReviewDecisions;
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

const compoundOf = (blocked: Blocked): ReviewDecisions => {
  const compound = { accepted: [...blocked.accepted], rejected: [...blocked.rejected] };
  if (blocked.reason !== "dependent-changes") return compound;
  for (const { changeId, dependentIds } of blocked.dependencies) {
    const side = compound[blocked.accepted.includes(changeId) ? "accepted" : "rejected"];
    for (const id of dependentIds) if (!side.includes(id)) side.push(id);
  }
  return compound;
};

const single = (decision: ReviewDecision, ids: string[]): ReviewDecisions =>
  decision === "accepted" ? { accepted: ids, rejected: [] } : { accepted: [], rejected: ids };

/**
 * The one way this package decides tracked changes.
 *
 * Every Accept and Reject goes through here so a click on a live editor ends in
 * one of two places: the decision is carried out, or the reviewer is told what
 * stopped it. A refusal is held as state rather than thrown away, because the card that
 * was clicked is where the explanation belongs.
 *
 * Deciding dependent work is never automatic. The set is computed so it can be
 * shown, named behind a second confirmation, and replanned at the moment of
 * confirming — if it grew since the reviewer saw it, they see the wider set
 * before anything is decided, not after.
 */
export function useReviewAction(editor: IBaseEditor | null) {
  const [refusal, setRefusal] = useState<ReviewRefusalState | null>(null);

  const pendingIds = useCallback(
    (): string[] =>
      (editor && trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map(c => c.id)) ?? [],
    [editor],
  );

  const changesById = useCallback(
    (ids: string[]): TrackedChange[] => {
      const all =
        (editor && trackChangesPluginKey.getState(editor.getState())?.changeSet.changes) ?? [];
      return ids
        .map(id => all.find(change => change.id === id))
        .filter((change): change is TrackedChange => !!change);
    },
    [editor],
  );

  const holdRefusal = useCallback(
    (request: ReviewDecisions, blocked: Blocked, stage: ReviewRefusalState["stage"], seen: string[] = []) => {
      const dependentIds = dependentIdsOf(blocked);
      setRefusal({
        request,
        why: blocked,
        compound: compoundOf(blocked),
        // A replan reports only what lies outside the set it was given, and that
        // set is still being decided, so what the reviewer already saw stays listed.
        dependents: changesById([...new Set([...seen, ...dependentIds])]),
        stage,
        // Only meaningful once the set has been shown; nothing has grown the
        // first time the reviewer is told about it.
        grew: stage !== "explain" && dependentIds.some(id => !seen.includes(id)),
      });
    },
    [changesById],
  );

  /**
   * Record the outcome where the surface can show it, and hand it back. Only a
   * refusal is held: `unavailable` is a lifecycle state for controls to reflect,
   * not something to tell a reviewer they were refused.
   */
  const settle = useCallback(
    (request: ReviewDecisions, outcome: ReviewOutcome): ReviewOutcome => {
      if (outcome.status === "blocked") holdRefusal(request, outcome, "explain");
      else setRefusal(null);
      return outcome;
    },
    [holdRefusal],
  );

  const carryOut = useCallback(
    (decisions: ReviewDecisions): ReviewOutcome => settle(decisions, reviewChanges(editor, decisions)),
    [editor, settle],
  );

  /**
   * Attempt exactly what the reviewer asked for, and nothing more. Usable
   * before the editor exists: that answers `unavailable`, which a caller must
   * be able to tell apart from a refusal, so it is never nothing.
   */
  const decide = useCallback(
    (decision: ReviewDecision, ids: string[]): ReviewOutcome => carryOut(single(decision, ids)),
    [carryOut],
  );

  /**
   * Keep one change and discard the others — a conflict resolution. It is one
   * decision even though it is two statuses, so it is planned and carried out
   * as one: neither half can land without the other.
   */
  const resolveConflict = useCallback(
    (keepId: string, discardIds: string[]): ReviewOutcome =>
      carryOut({ accepted: [keepId], rejected: discardIds }),
    [carryOut],
  );

  /** Show the dependent work in place. Shows it; authorizes nothing. */
  const listDependents = useCallback(() => {
    setRefusal(current =>
      current?.stage === "explain" ? { ...current, stage: "listed" } : current,
    );
  }, []);

  /**
   * Replan the compound decision against the document as it stands. Both the
   * confirmation and the decision itself go through here, so neither can decide
   * dependent work the reviewer has not been shown. Dependent work decided elsewhere in
   * the meantime is no longer part of it; what the reviewer asked for still is.
   */
  const replan = useCallback(
    (held: ReviewRefusalState): ReviewPlanResult => {
      const asked = new Set([...held.request.accepted, ...held.request.rejected]);
      const pending = new Set(pendingIds());
      const live = (ids: string[]) => ids.filter(id => asked.has(id) || pending.has(id));
      const plan = planReview(editor, {
        accepted: live(held.compound.accepted),
        rejected: live(held.compound.rejected),
      });
      if (plan.status === "blocked") {
        holdRefusal(held.request, plan, "confirm", held.dependents.map(c => c.id));
      }
      return plan;
    },
    [editor, pendingIds, holdRefusal],
  );

  /** Open the confirmation for the compound decision, listing what it covers. */
  const requestConfirm = useCallback(() => {
    if (!refusal) return;
    const plan = replan(refusal);
    if (plan.status === "ready") {
      setRefusal({ ...refusal, compound: { accepted: plan.accepted, rejected: plan.rejected }, stage: "confirm", grew: false });
    }
  }, [replan, refusal]);

  /**
   * Send the compound decision, which `replan` has just re-checked. A replan
   * that no longer goes through is handed back as it is — the wider set it
   * found is now on show for the reviewer to confirm. With no refusal held there
   * is nothing to confirm, which is not the same as something having happened.
   */
  const confirm = useCallback((): ReviewOutcome | null => {
    if (!refusal) return null;
    const plan = replan(refusal);
    if (plan.status !== "ready") return plan;
    return settle(refusal.request, reviewChanges(editor, { accepted: plan.accepted, rejected: plan.rejected }));
  }, [refusal, replan, settle, editor]);

  const dismiss = useCallback(() => setRefusal(null), []);

  return useMemo(
    () => ({
      /** False while there is no editor to decide against — disable controls. */
      available: !!editor,
      decide,
      refusal,
      listDependents,
      requestConfirm,
      confirm,
      resolveConflict,
      dismiss,
    }),
    [editor, decide, refusal, listDependents, requestConfirm, confirm, resolveConflict, dismiss],
  );
}

/**
 * What a review surface holds. `decide` and `resolveConflict` report the outcome;
 * `refusal` is what stopped the last one, for `ReviewRefusalNotice` to show.
 */
export type ReviewAction = ReturnType<typeof useReviewAction>;
