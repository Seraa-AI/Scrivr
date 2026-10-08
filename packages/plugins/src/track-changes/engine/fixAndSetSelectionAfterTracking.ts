import { Selection, Transaction } from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";

/**
 * The replayed transaction already carries the gesture's selection: ProseMirror
 * maps it as each replay step applies, which keeps a range a range, keeps its
 * direction, and keeps whatever kind it was. Re-deriving it from one composed
 * mapping is strictly worse — a structural step's undo-and-restamp destroys
 * interior positions that per-step mapping survives.
 *
 * So only one case is left to decide: a caret that trailed an insertion belongs
 * after the content the replay stamped, not at the boundary the undo left. That
 * may move a caret and must never collapse a range the gesture left standing.
 */
export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  oldTr: Transaction,
  trContext: TrTrackingContext,
) {
  const caretFromInsertion = trContext.selectionPosFromInsertion;

  if (
    newTr.selection.empty &&
    !oldTr.selectionSet &&
    caretFromInsertion !== undefined &&
    caretFromInsertion <= newTr.doc.content.size
  ) {
    newTr.setSelection(
      Selection.near(newTr.doc.resolve(caretFromInsertion), -1),
    );
  }

  return newTr;
}
