import { canJoin, Node as PMNode, Transaction } from "@scrivr/core/pm";

import {
  addTrackIdIfDoesntExist,
  createNewJoinAttrs,
  getBlockInlineTrackedData,
  NewEmptyAttrs,
} from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS } from "../types";

const recordsOf = (node: PMNode) => getBlockInlineTrackedData(node) ?? [];

/** Does this node carry a pending record of one of `operations` by this author? */
export const addedBy = (node: PMNode, authorID: string, operations: CHANGE_OPERATION[]) =>
  recordsOf(node).some(record =>
    record.status === CHANGE_STATUS.pending && record.authorID === authorID && !record.foldingClosed &&
    record.operation !== undefined && operations.includes(record.operation),
  );

/**
 * Did this author add the block that starts at a break, so that deleting the
 * break takes their proposal back out rather than proposing a join?
 */
export const addedBreakBy = (next: PMNode, authorID: string) =>
  addedBy(next, authorID, [CHANGE_OPERATION.insert, CHANGE_OPERATION.node_split]);

/**
 * Where the block a deleted break joins onto starts: the next block with text
 * after `blockEnd`, past whatever closes and opens between them, as list items do.
 */
export function joinedBlockAt(doc: PMNode, blockEnd: number): number | undefined {
  let joined: number | undefined;
  doc.nodesBetween(blockEnd, doc.content.size, (candidate, at) => {
    if (joined === undefined && at >= blockEnd && candidate.isTextblock) joined = at;
    return joined === undefined;
  });
  return joined;
}

/**
 * Settles an accepted break deletion: the block carrying it runs on into the
 * next block with text, through whatever closes and opens between them, as list
 * items do. Run once deletions are applied, so a block deleted between the two
 * is gone first and the right neighbours meet; and from the back, since the
 * block that joins on takes no records with it.
 */
export function acceptBreakDeletion(tr: Transaction, id: string) {
  let found: { node: PMNode; pos: number } | undefined;
  tr.doc.descendants((node, pos) => {
    if (!found && recordsOf(node).some(record => record.id === id)) found = { node, pos };
    return !found;
  });
  if (!found) return;
  const { node, pos } = found;
  const records = recordsOf(node).filter(record => record.id !== id);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked: records.length ? records : null }, node.marks);
  const joined = joinedBlockAt(tr.doc, pos + node.nodeSize);
  if (joined !== undefined) tr.delete(pos + node.nodeSize - 1, joined + 1);
}

/**
 * Deletes the break ending the block at `pos`. A break its author added is
 * still only their proposal, so it is taken back out: the two blocks join, and
 * the one that was there before keeps its identity. Any other break is proposed
 * for deletion, and the blocks stay apart until that is accepted.
 */
export function deleteBreak(pos: number, joinsNext: boolean, newTr: Transaction, attrs: NewEmptyAttrs) {
  const node = newTr.doc.nodeAt(pos);
  if (!node) return;
  const boundary = pos + node.nodeSize;
  const next = newTr.doc.nodeAt(boundary);
  const addedNext = !!next && addedBreakBy(next, attrs.authorID);
  const addedThis = addedBy(node, attrs.authorID, [CHANGE_OPERATION.insert]);

  if (joinsNext && next && (addedNext || addedThis) && canJoin(newTr.doc, boundary)) {
    const [kept, taken] = addedNext ? [node, next] : [next, node];
    const takenIds = new Set(recordsOf(taken).map(record => record.id));
    // A record pointing at the break that is gone points at nothing.
    const records = recordsOf(kept).filter(record =>
      !(record.operation === CHANGE_OPERATION.reference && "referenceId" in record && takenIds.has(record.referenceId)),
    );
    newTr.join(boundary);
    newTr.setNodeMarkup(pos, kept.type, { ...kept.attrs, dataTracked: records.length ? records : null }, kept.marks);
    return;
  }

  const records = recordsOf(node);
  if (records.some(record => record.operation === CHANGE_OPERATION.node_join && record.status === CHANGE_STATUS.pending)) {
    return;
  }
  newTr.setNodeMarkup(
    pos,
    undefined,
    { ...node.attrs, dataTracked: [...records, addTrackIdIfDoesntExist(createNewJoinAttrs(attrs))] },
    node.marks,
  );
}
