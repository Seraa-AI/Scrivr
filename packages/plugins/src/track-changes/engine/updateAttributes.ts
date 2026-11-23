import { Mark, Node as PMNode, Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { Mapping } from "@scrivr/core/pm";

import { ChangeSet } from "../ChangeSet";
import { clearTextChange } from "../lib/clearTextChange";
import {
  getBlockInlineTrackedData,
  excludeFromTracked,
} from "../helpers";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  DataTrackedAttrs,
  IncompleteChange,
  MarkChange,
  PartialChange,
  TrackedAttrs,
  TrackedChange,
} from "../types";

const isMarkChange = (change: IncompleteChange): change is PartialChange<MarkChange> =>
  change.type === "mark-change";

function trackedId(mark: Mark): string | undefined {
  const dataTracked: { id?: string } | null = mark.attrs.dataTracked;
  return dataTracked?.id;
}

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
        (m.type === schema.marks.trackedInsert || m.type === schema.marks.trackedDelete) &&
        trackedId(m) === change.id,
    ) ?? node.marks.find(
      m => m.type === schema.marks.trackedInsert || m.type === schema.marks.trackedDelete,
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
      // Tracked marks coexist (`excludes: ""`), so adding the updated record
      // without taking the old one off would leave both on the text.
      tr.removeMark(change.from, change.to, oldMark);
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
    // A record that says no operation cannot be decided: it is dropped, and
    // only it — the block's other records are other changes.
    const others = (getBlockInlineTrackedData(node) || []).filter(t => t.id !== change.id);
    tr.setNodeMarkup(
      change.from,
      undefined,
      { ...node.attrs, dataTracked: others.length === 0 ? null : others },
      node.marks,
    );
  } else if (change.type === "reference-change") {
    // A reference is decided with the split it points at, never on its own;
    // all it takes here is the bookkeeping on its record.
    const records = (getBlockInlineTrackedData(node) || []).map(t => (t.id === change.id ? { ...t, ...trackedAttrs } : t));
    tr.setNodeMarkup(change.from, undefined, { ...node.attrs, dataTracked: records }, node.marks);
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
  } else if (isMarkChange(change)) {
    if (change.mark && change.from && change.to) {
      // The record by its id: several on one mark can share an operation.
      const isThisRecord = (dt: DataTrackedAttrs) =>
        dt.id === change.dataTracked.id && dt.operation === change.dataTracked.operation;
      const type = change.mark.type;
      const rewrite = (mark: Mark) => {
        const records: DataTrackedAttrs[] = Array.isArray(mark.attrs.dataTracked) ? mark.attrs.dataTracked : [];
        if (!records.some(isThisRecord)) return null;
        return type.create({ ...mark.attrs, dataTracked: records.map(dt => (isThisRecord(dt) ? { ...dt, ...trackedAttrs } : dt)) });
      };
      if (change.nodeType.isInline) {
        // Text by text, as this transaction has left it: another record on the
        // same mark may cover only part of the range, and must stay on its part.
        const pieces: Array<{ from: number; to: number; mark: Mark }> = [];
        tr.doc.nodesBetween(change.from, change.to, (node, pos) => {
          const mark = node.isInline ? node.marks.find(m => m.type === type) : undefined;
          if (mark) pieces.push({ from: Math.max(pos, change.from), to: Math.min(pos + node.nodeSize, change.to), mark });
        });
        for (const piece of pieces) {
          const updated = rewrite(piece.mark);
          if (!updated) continue;
          tr.removeMark(piece.from, piece.to, piece.mark);
          tr.addMark(piece.from, piece.to, updated);
        }
      } else {
        const current = tr.doc.nodeAt(change.from)?.marks.find(m => m.type === type) ?? change.mark;
        const updated = rewrite(current);
        if (updated) {
          tr.removeNodeMark(change.from, current);
          tr.addNodeMark(change.from, updated);
        }
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
    if (c.type === "node-change" && c.dataTracked.status !== CHANGE_STATUS.pending && !ChangeSet.shouldDeleteChange(c)) {
      const from = mapping.map(c.from);
      const node = tr.doc.nodeAt(from);
      if (!node) {
        return;
      }
      const attrs = { ...node.attrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, c.id) };
      tr.setNodeMarkup(from, undefined, attrs, node.marks);
    }
  });
}

/**
 * Clears one change's record off a restored node. Anything else the node carries
 * is another decision — often another author's — and outlives this review.
 */
export function restoreNode(
  tr: Transaction,
  node: PMNode,
  pos: number,
  id: string,
): void {
  tr.setNodeMarkup(
    pos,
    undefined,
    { ...node.attrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, id) },
    node.marks,
  );
  clearTextChange(tr, pos, pos + node.nodeSize, id);
}
