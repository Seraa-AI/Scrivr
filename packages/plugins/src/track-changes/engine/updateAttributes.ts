import { Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";

import { ChangeSet } from "../ChangeSet";
import {
  getBlockInlineTrackedData,
} from "../helpers";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  DataTrackedAttrs,
  IncompleteChange,
  MarkChange,
  TrackedAttrs,
  TrackedChange,
} from "../types";

export function updateChangeAttrs(
  tr: Transaction,
  change: IncompleteChange,
  trackedAttrs: Partial<TrackedAttrs>,
  schema: Schema,
): Transaction {
  const node = tr.doc.nodeAt(change.from);
  if (!node) {
    console.error("updateChangeAttrs: no node at the from of change ", change);
    return tr;
  }

  const { operation } = trackedAttrs;
  if (!operation) {
    console.warn(
      "updateChangeAttrs: unable to determine operation of change ",
      change,
    );
  }
  if (change.type === "text-change") {
    // Find the specific mark that corresponds to this change (matched by id).
    const oldMark = node.marks.find(
      m =>
        (m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete) &&
        (m.attrs.dataTracked as { id?: string } | null)?.id === change.id,
    ) ?? node.marks.find(
      m => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete,
    );
    if (!oldMark) {
      console.warn(
        "updateChangeAttrs: no track marks for a text-change ",
        change,
      );
      return tr;
    }

    if (
      trackedAttrs.status === CHANGE_STATUS.accepted ||
      trackedAttrs.status === CHANGE_STATUS.rejected
    ) {
      tr.removeMark(change.from, change.to, oldMark);
    } else {
      tr.addMark(
        change.from,
        change.to,
        oldMark.type.create({
          ...oldMark.attrs,
          dataTracked: { ...oldMark.attrs.dataTracked, ...trackedAttrs },
        }),
      );
    }
  } else if (
    (change.type === "node-change" || change.type === "node-attr-change") &&
    !operation
  ) {
    tr.setNodeMarkup(
      change.from,
      undefined,
      { ...node.attrs, dataTracked: null },
      node.marks,
    );
  } else if (
    change.type === "node-change" ||
    change.type === "node-attr-change"
  ) {
    let restoredAttrs: Record<string, any> | undefined = undefined;
    if (
      trackedAttrs.operation === CHANGE_OPERATION.set_node_attributes &&
      trackedAttrs.status === CHANGE_STATUS.rejected
    ) {
      restoredAttrs = trackedAttrs.oldAttrs;
    }

    const trackedDataSource = getBlockInlineTrackedData(node) || [];
    const targetDataTracked = trackedDataSource.find(t => change.id === t.id);
    const newDataTracked = trackedDataSource
      .map(oldTrack => {
        if (targetDataTracked) {
          if (oldTrack.id === targetDataTracked.id) {
            if (
              trackedAttrs.status === CHANGE_STATUS.accepted ||
              trackedAttrs.status === CHANGE_STATUS.rejected
            ) {
              return null;
            }
            return { ...oldTrack, ...trackedAttrs };
          }
          return oldTrack;
        }

        if (oldTrack.operation === operation) {
          if (
            trackedAttrs.status === CHANGE_STATUS.accepted ||
            trackedAttrs.status === CHANGE_STATUS.rejected
          ) {
            return null;
          }
          return { ...oldTrack, ...trackedAttrs };
        }
        return oldTrack;
      })
      .filter(Boolean);

    tr.setNodeMarkup(
      change.from,
      undefined,
      {
        ...(restoredAttrs || node.attrs),
        dataTracked: newDataTracked.length === 0 ? null : newDataTracked,
      },
      node.marks,
    );
  } else if (change.type === "mark-change") {
    const markChange = change as MarkChange;
    if (markChange.mark && markChange.from && markChange.to) {
      const markDataTracked = Array.isArray(markChange.mark.attrs.dataTracked)
        ? (markChange.mark.attrs.dataTracked as DataTrackedAttrs[])
        : [];
      const newDT = markDataTracked?.map(dt => {
        if (
          dt.createdAt === change.dataTracked.createdAt &&
          dt.operation === change.dataTracked.operation
        ) {
          return {
            ...dt,
            ...trackedAttrs,
          };
        }
        return dt;
      });
      const newMark = markChange.mark.type.create({
        ...markChange.mark.attrs,
        dataTracked: newDT,
      });
      if (ChangeSet.isInlineMarkChange(markChange)) {
        tr.removeMark(markChange.from, markChange.to, markChange.mark);
        tr.addMark(markChange.from, markChange.to, newMark);
      } else {
        tr.removeNodeMark(markChange.from, markChange.mark);
        tr.addNodeMark(markChange.from, newMark);
      }
    } else {
      console.warn(
        "Unable to update a mark change because the mark change data are incomplete",
      );
    }
  }
  return tr;
}

export function updateChangeChildrenAttributes(
  changes: TrackedChange[],
  tr: Transaction,
  mapping: Mapping,
) {
  changes.forEach(c => {
    if (c.type === "node-change" && !ChangeSet.shouldDeleteChange(c)) {
      const from = mapping.map(c.from);
      const node = tr.doc.nodeAt(from);
      if (!node) {
        return;
      }
      const attrs = { ...node.attrs, dataTracked: null };
      tr.setNodeMarkup(from, undefined, attrs, node.marks);
    }
  });
}

export function restoreNode(
  tr: Transaction,
  node: any,
  pos: number,
  schema: Schema,
): void {
  const updatedAttrs = {
    ...node.attrs,
    dataTracked: null,
  };

  tr.setNodeMarkup(pos, undefined, updatedAttrs, node.marks);
  tr.removeMark(pos, pos + node.nodeSize, schema.marks.tracked_insert);
  tr.removeMark(pos, pos + node.nodeSize, schema.marks.tracked_delete);
}
