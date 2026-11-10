import type { SemanticTextView } from "@scrivr/core";
import { EditorState } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { findChanges } from "./findChanges";
import { planChangeReview } from "./reviewPlan";
import { updateChangesStatus } from "./engine/updateChangesStatus";

/** Who the throwaway review is stamped by; the copy it decides is never kept. */
const VIEW_READER = "semantic:original";

/**
 * The document as the semantic `view` reads it. The original view is what
 * rejecting every pending proposal leaves — this engine's own Reject, run on a
 * copy, so it reads right for every kind of record. Null for the proposed
 * view, which is the document itself, and when nothing is pending.
 *
 * Rejecting all of them at once is never blocked: every act and every piece
 * it depends on is decided together. An engine that fails to carry it out has
 * already reported why, and the lane reads the document as it is.
 */
export function documentIn(doc: PMNode, view: SemanticTextView): PMNode | null {
  if (view !== "original") return null;
  const state = EditorState.create({ doc });
  const changeSet = findChanges(state);
  const rejected = changeSet.pending.map((change) => change.id);
  if (rejected.length === 0) return null;
  const plan = planChangeReview(changeSet, { accepted: [], rejected });
  if (plan.status !== "ready") return null;
  const tr = state.tr;
  return updateChangesStatus(tr, changeSet, plan, VIEW_READER).status === "applied" ? tr.doc : null;
}
