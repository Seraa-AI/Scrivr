import { Mapping, Selection, Transaction } from "@scrivr/core/pm";

import { TrTrackingContext } from "../types";

/**
 * A position in the document the user's transaction produced reaches the
 * replayed document in two hops: back out of the user's own steps, then forward
 * through the bridge the replay accumulated. Composing them is the only frame
 * that spans both, which is why selection must not be mapped through either
 * half alone.
 */
function replayMapping(oldTr: Transaction, replayBridge: Mapping): Mapping {
  const mapping = oldTr.mapping.invert();
  mapping.appendMapping(replayBridge);
  return mapping;
}

/**
 * Carries the gesture's selection across the replay rather than rebuilding it.
 *
 * Every selection kind knows how to map itself — text keeps anchor and head
 * apart, so range and direction survive; a node selection re-validates its
 * target; a cell selection stays a cell selection. Asking the selection is what
 * makes this total over kinds the engine has never heard of.
 *
 * Mapping cannot answer one case: a caret that trailed an insertion belongs
 * after the content the replay just stamped, not at the boundary undoing the
 * user's step left behind. That intent may only move a caret — collapsing a
 * range the gesture left standing would discard what the person had selected.
 */
export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  oldTr: Transaction,
  replayBridge: Mapping,
  trContext: TrTrackingContext,
) {
  const carried = oldTr.selection.map(
    newTr.doc,
    replayMapping(oldTr, replayBridge),
  );
  const caretFromInsertion = trContext.selectionPosFromInsertion;

  if (
    carried.empty &&
    !oldTr.selectionSet &&
    caretFromInsertion !== undefined &&
    caretFromInsertion <= newTr.doc.content.size
  ) {
    newTr.setSelection(
      Selection.near(newTr.doc.resolve(caretFromInsertion), -1),
    );
    return newTr;
  }

  newTr.setSelection(carried);
  return newTr;
}
