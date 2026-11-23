import { Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";

import { ChangeSet } from "../ChangeSet";
import { updateChangeAttrs } from "../engine/updateAttributes";
import { genId } from "../helpers";
import { CHANGE_STATUS } from "../types";

/** A split piece's id: derived, so every client repairing the same document agrees. */
const pieceId = (id: string, from: number) => `${id}~${from}`;

/**
 * Repairs records the change set cannot represent: one id carried by more than
 * one span, and records missing required attributes.
 *
 * An id names one contiguous span. When later work splits a record — typing
 * inside a deletion — each piece after the first gets its own id, and keeps the
 * original as `continuesId` so the pieces are still reviewed as one change.
 */
export function fixInconsistentChanges(
  changeSet: ChangeSet,
  currentUserID: string,
  newTr: Transaction,
  schema: Schema,
) {
  const claimed = new Set(changeSet.changes.map(c => c.id));
  let changed = false;

  changeSet.invalidChanges.forEach(c => {
    // A held suggestion is in its holder's record, not on the text: repairing it would write it there.
    if (c.type === "mark-change" && "within" in c && c.within !== undefined) return;
    const { id, authorID, reviewedByID, status, createdAt, statusUpdateAt, updatedAt } = c.dataTracked;
    const piece = !!id && claimed.has(id);
    const newAttrs = {
      ...(piece && { id: pieceId(id, c.from), continuesId: c.dataTracked.continuesId ?? id }),
      ...(!id && { id: genId() }),
      ...(!authorID && { authorID: currentUserID }),
      ...(!reviewedByID && { reviewedByID: null }),
      ...(!status && { status: CHANGE_STATUS.pending }),
      ...(!createdAt && { createdAt: Date.now() }),
      ...(!updatedAt && { updatedAt: Date.now() }),
      ...(!statusUpdateAt && { statusUpdateAt: 0 }),
    };
    if (Object.keys(newAttrs).length > 0) {
      updateChangeAttrs(newTr, c, { ...c.dataTracked, ...newAttrs }, schema);
      changed = true;
    }
    const claimedId = newAttrs.id ?? id;
    if (claimedId) claimed.add(claimedId);
  });

  // A change the set already counts keeps its id; only its bookkeeping is filled.
  changeSet.unstampedChanges.forEach(c => {
    // A held suggestion is in its holder's record, not on the text: it is filled with its holder.
    if (c.type === "mark-change" && "within" in c && c.within !== undefined) return;
    const { createdAt, updatedAt, statusUpdateAt, reviewedByID } = c.dataTracked;
    updateChangeAttrs(newTr, c, {
      ...c.dataTracked,
      ...(!createdAt && { createdAt: Date.now() }),
      ...(!updatedAt && { updatedAt: Date.now() }),
      ...(!statusUpdateAt && { statusUpdateAt: 0 }),
      ...(reviewedByID === undefined && { reviewedByID: null }),
    }, schema);
    changed = true;
  });

  return changed;
}
