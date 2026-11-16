import type { SemanticTextView } from "@scrivr/core";
import { EditorState } from "@scrivr/core/pm";
import type { Mapping, Node as PMNode } from "@scrivr/core/pm";
import { findChanges } from "./findChanges";
import { planChangeReview } from "./reviewPlan";
import { updateChangesStatus } from "./engine/updateChangesStatus";

/** Who the throwaway review is stamped by; the copy it decides is never kept. */
const VIEW_READER = "semantic:original";

/**
 * The document as agreed before every pending proposal: what rejecting all of
 * them leaves — this engine's own Reject, run on a copy, so it reads right for
 * every kind of record — with the mapping from `doc`'s positions to its. Null
 * when nothing is pending: the original is `doc` itself.
 *
 * Rejecting all of them at once is never blocked — every act and every piece it
 * depends on is decided together — so a review that cannot be carried out is an
 * engine fault, reported rather than read as some other document.
 */
export function originalDocument(doc: PMNode): { doc: PMNode; mapping: Mapping } | null {
  const state = EditorState.create({ doc });
  const changeSet = findChanges(state);
  const rejected = changeSet.pending.map((change) => change.id);
  if (rejected.length === 0) return null;
  const plan = planChangeReview(changeSet, { accepted: [], rejected });
  const tr = state.tr;
  if (plan.status !== "ready" || updateChangesStatus(tr, changeSet, plan, VIEW_READER).status !== "applied") {
    throw new Error("@scrivr/plugins track-changes: the original view could not be computed — rejecting every pending change failed");
  }
  return { doc: tr.doc, mapping: tr.mapping };
}

/** The document the semantic `view` reads: the original's, or null for the proposed view, which is `doc` itself. */
export function documentIn(doc: PMNode, view: SemanticTextView): PMNode | null {
  return view === "original" ? originalDocument(doc)?.doc ?? null : null;
}
