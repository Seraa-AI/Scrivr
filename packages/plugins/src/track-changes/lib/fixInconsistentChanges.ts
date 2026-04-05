import { Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";

import { ChangeSet } from "../ChangeSet";
import { updateChangeAttrs } from "../engine/updateAttributes";
import { genId } from "../helpers";
import { CHANGE_STATUS } from "../types";

/**
 * Iterates over a ChangeSet and repairs changes that are missing required attributes or have duplicate IDs.
 */
export function fixInconsistentChanges(
  changeSet: ChangeSet,
  currentUserID: string,
  newTr: Transaction,
  schema: Schema,
) {
  const iteratedIds = new Set();
  const validIds = new Set(changeSet.changes.map(c => c.id));
  let changed = false;

  changeSet.invalidChanges.forEach(c => {
    const { id, authorID, reviewedByID, status, createdAt, statusUpdateAt, updatedAt } = c.dataTracked;
    const newAttrs = {
      ...((!id || iteratedIds.has(id) || validIds.has(id) || id.length === 0) && { id: genId() }),
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
    iteratedIds.add(newAttrs.id || id);
  });

  return changed;
}
