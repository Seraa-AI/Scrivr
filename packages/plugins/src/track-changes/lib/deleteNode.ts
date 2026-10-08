import { Fragment, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";

import { alreadyProposedForDeletion, canCancelInsertion } from "./deletionPolicy";
import { dropStructuralChangeShadow } from "./structuralChange";
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData, NewDeleteAttrs } from "../helpers";
import { CHANGE_OPERATION } from "../types";

/** Deletes node but tries to leave content intact by merging upward first. */
export function deleteNode(node: PMNode, pos: number, tr: Transaction) {
  const resPos = tr.doc.resolve(pos);
  const canMergeToNodeAbove =
    resPos.parent !== tr.doc && resPos.nodeBefore && node.isBlock && node.firstChild?.isText;
  if (canMergeToNodeAbove) {
    return tr.replaceWith(pos - 1, pos + 1, Fragment.empty);
  }
  return tr.delete(pos, pos + node.nodeSize);
}

/** Apply the shared ownership policy. Returns true only when the node was removed. */
export function deleteOrSetNodeDeleted(
  node: PMNode,
  pos: number,
  newTr: Transaction,
  deleteAttrs: NewDeleteAttrs,
  allowCancellation = true,
) {
  const dataTracked = getBlockInlineTrackedData(node);
  const structure = dataTracked?.find(c => c.operation === CHANGE_OPERATION.structure);

  if (deleteAttrs.moveNodeId && structure && structure.moveNodeId !== deleteAttrs.moveNodeId) {
    newTr.delete(pos, pos + node.nodeSize);
    return true;
  }

  if (!deleteAttrs.moveNodeId && allowCancellation && canCancelInsertion(node, deleteAttrs.authorID)) {
    newTr.delete(pos, pos + node.nodeSize);
    return true;
  }

  if (!deleteAttrs.moveNodeId && alreadyProposedForDeletion(node)) return false;

  if (!newTr.doc.nodeAt(pos)) {
    console.error("deleteOrSetNodeDeleted: no node found for deletion", { pos, node, newTr });
    return false;
  }

  const newDeleted = addTrackIdIfDoesntExist(deleteAttrs);
  newTr.setNodeMarkup(
    pos,
    undefined,
    {
      ...node.attrs,
      dataTracked: [...(dataTracked ?? []), newDeleted],
    },
    node.marks,
  );

  if (!deleteAttrs.moveNodeId && structure?.moveNodeId) {
    dropStructuralChangeShadow(structure.moveNodeId, newTr);
  }
  return false;
}
