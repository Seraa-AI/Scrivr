import { Selection, Transaction } from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";

/**
 * The replayed transaction already carries the gesture's selection, mapped
 * forward through the replay steps, which keeps a range a range, keeps its
 * direction, and keeps whatever kind it was.
 *
 * One case mapping cannot answer: a caret that trailed a step. The replay undoes
 * the step before restamping it, and a position at the edge of undone content
 * maps past whatever the undo put back. Such a caret belongs after the content
 * the replay stamped, which the tracker reports.
 */
export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  trContext: TrTrackingContext,
) {
  const caretFromInsertion = trContext.selectionPosFromInsertion;

  if (caretFromInsertion !== undefined && caretFromInsertion <= newTr.doc.content.size) {
    newTr.setSelection(
      Selection.near(newTr.doc.resolve(caretFromInsertion), -1),
    );
  }

  return newTr;
}
