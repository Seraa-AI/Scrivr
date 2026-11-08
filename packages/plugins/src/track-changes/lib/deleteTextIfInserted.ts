import { Fragment, Node as PMNode, Schema } from "@scrivr/core/pm";
import type { Transaction } from "@scrivr/core/pm";

import { alreadyProposedForDeletion, canCancelInsertion } from "./deletionPolicy";
import { addTrackIdIfDoesntExist, getMergeableMarkTrackedAttrs, NewDeleteAttrs } from "../helpers";

/**
 * Removes the text outright when `canCancelInsertion` allows it; text already
 * struck gets no second record; otherwise it is wrapped in a trackedDelete,
 * merged with an adjacent mergeable deletion.
 *
 * Returns the position at the end of the possibly deleted text.
 */
export function deleteTextIfInserted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  schema: Schema,
  deleteAttrs: NewDeleteAttrs,
  from?: number,
  to?: number,
  allowCancellation = true,
) {
  const start = from !== undefined ? Math.max(pos, from) : pos;
  const nodeEnd = pos + node.nodeSize;
  const end = to !== undefined ? Math.min(nodeEnd, to) : nodeEnd;

  if (allowCancellation && canCancelInsertion(node, deleteAttrs.authorID)) {
    newTr.replaceWith(start, end, Fragment.empty);
    return start;
  }

  if (!deleteAttrs.moveNodeId && alreadyProposedForDeletion(node)) return end;

  const leftNode = newTr.doc.resolve(start).nodeBefore;
  const leftMarks = getMergeableMarkTrackedAttrs(leftNode, deleteAttrs, schema);
  const rightNode = newTr.doc.resolve(end).nodeAfter;
  const rightMarks = getMergeableMarkTrackedAttrs(rightNode, deleteAttrs, schema);

  const fromStartOfMark = start - (leftNode && leftMarks ? leftNode.nodeSize : 0);
  const toEndOfMark = end + (rightNode && rightMarks ? rightNode.nodeSize : 0);
  const createdAt = Math.min(
    leftMarks?.createdAt || Number.MAX_VALUE,
    rightMarks?.createdAt || Number.MAX_VALUE,
    deleteAttrs.createdAt,
  );

  const dataTracked = addTrackIdIfDoesntExist({ ...leftMarks, ...rightMarks, ...deleteAttrs, createdAt });

  newTr.addMark(
    fromStartOfMark,
    toEndOfMark,
    schema.marks!.trackedDelete!.create({ dataTracked }),
  );

  return toEndOfMark;
}
