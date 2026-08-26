import { EditorState, Transaction } from "@scrivr/core/pm";

import { ChangeSet } from "../ChangeSet";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  TextChange,
  TrackedChange,
} from "../types";
import { dropOrphanChanges } from "../lib/structuralChange";
import { applyChanges } from "../applyChanges";

export function updateChangesStatus(
  createdTr: Transaction,
  changeSet: ChangeSet,
  ids: string[],
  status: CHANGE_STATUS,
  userID: string,
  oldState: EditorState,
) {
  const change = changeSet.get(ids[0]!);
  const changeTime = new Date().getTime();

  if (change && status !== CHANGE_STATUS.pending) {
    const textChanges: TextChange[] = [];
    const nonTextChanges: TrackedChange[] = [];

    changeSet.changes.forEach(c => {
      if (ids.includes(c.id)) {
        c.dataTracked.status = status;
        if (ChangeSet.isTextChange(c)) {
          textChanges.push(c);
        } else {
          nonTextChanges.push(c);

          if (c.dataTracked.operation === CHANGE_OPERATION.node_split) {
            const relatedRefChange = changeSet.changes.find(
              c =>
                c.dataTracked.operation === "reference" &&
                c.dataTracked.referenceId === change.id,
            );
            if (relatedRefChange) {
              nonTextChanges.push(relatedRefChange);
            }
          }
          if (c.dataTracked.operation === CHANGE_OPERATION.move) {
            const oldChange = changeSet.changeTree.find(
              c =>
                ChangeSet.isNodeChange(c) &&
                c.dataTracked.operation === "delete" &&
                c.dataTracked.moveNodeId === change.dataTracked.moveNodeId,
            );

            if (oldChange && ChangeSet.isNodeChange(oldChange)) {
              oldChange.children.forEach(child => {
                if (ChangeSet.isTextChange(child)) {
                  textChanges.push(child);
                } else {
                  nonTextChanges.push(child);
                }
              });

              nonTextChanges.push(oldChange);
            }
          }
        }
      }
    });

    const mapping = applyChanges(
      createdTr,
      oldState.schema,
      nonTextChanges,
      changeSet,
    );
    applyChanges(createdTr, oldState.schema, textChanges, changeSet, mapping);
    dropOrphanChanges(createdTr);
  } else {
    return;
  }
}
