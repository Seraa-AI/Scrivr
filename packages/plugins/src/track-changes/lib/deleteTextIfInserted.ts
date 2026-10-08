import { Fragment, Node as PMNode, Schema } from "@scrivr/core/pm";
import type { Transaction } from "@scrivr/core/pm";

import { canCancelInsertion } from "./deletionPolicy";
import { addTrackIdIfDoesntExist, getMergeableMarkTrackedAttrs, NewDeleteAttrs } from "../helpers";

/**
 * Deletes inserted text directly (same-author cancel); otherwise wraps it with
 * a trackedDelete mark — preserving the full grouping behaviour.
 *
 * Author-awareness: only cancel the insert outright if it belongs to the SAME
 * author. A different author's insert is left in place and receives a
 * trackedDelete mark on top — the conflict will be detected and flagged at
 * read-time by findChanges (isConflict is a computed property, not stored in
 * mark attrs, so no fragmentation here).
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

  // ── Original grouping logic — unchanged ────────────────────────────────────
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
