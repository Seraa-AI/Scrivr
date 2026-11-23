import type { SemanticTextView } from "@scrivr/core";
import { EditorState } from "@scrivr/core/pm";
import type { Mapping, Node as PMNode } from "@scrivr/core/pm";
import { findChanges } from "./findChanges";
import { planChangeReview } from "./reviewPlan";
import { updateChangesStatus } from "./engine/updateChangesStatus";

/** Who the throwaway review is stamped by; the copy it decides is never kept. */
const VIEW_READER = "semantic:view";

/**
 * The document as agreed before every pending proposal: what rejecting all of
 * them leaves, with the mapping from `doc`'s positions to its. Null when
 * nothing is pending: the original is `doc` itself.
 */
export function originalDocument(doc: PMNode): { doc: PMNode; mapping: Mapping } | null {
  return everyChangeDecided(doc, "rejected");
}

/**
 * The document as every pending proposal would leave it: what accepting all of
 * them leaves. Null when nothing is pending: the proposal is `doc` itself.
 */
export function proposedDocument(doc: PMNode): PMNode | null {
  return everyChangeDecided(doc, "accepted")?.doc ?? null;
}

/**
 * This engine's own review of every pending change, run on a copy, so it reads
 * right for every kind of record. Deciding all of them at once is never
 * blocked — every act and every piece it depends on is decided together — so a
 * review that cannot be carried out is an engine fault, reported rather than
 * read as some other document.
 */
function everyChangeDecided(doc: PMNode, decision: "accepted" | "rejected"): { doc: PMNode; mapping: Mapping } | null {
  const state = EditorState.create({ doc });
  const changeSet = findChanges(state);
  const ids = changeSet.pending.map((change) => change.id);
  if (ids.length === 0) return null;
  const plan = planChangeReview(changeSet, decision === "accepted" ? { accepted: ids, rejected: [] } : { accepted: [], rejected: ids });
  const tr = state.tr;
  if (plan.status !== "ready" || updateChangesStatus(tr, changeSet, plan, VIEW_READER).status !== "applied") {
    throw new Error(`@scrivr/plugins track-changes: a view could not be computed — deciding every pending change as ${decision} failed`);
  }
  return { doc: tr.doc, mapping: tr.mapping };
}

/** The document the semantic `view` reads: the original's, or null for the proposed view, which is `doc` itself. */
export function documentIn(doc: PMNode, view: SemanticTextView): PMNode | null {
  return view === "original" ? originalDocument(doc)?.doc ?? null : null;
}
