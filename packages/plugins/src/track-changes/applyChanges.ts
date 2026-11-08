import { Node as PMNode, Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { Mapping } from "@scrivr/core/pm";

import { revertWrapNodeChange } from "./lib/revertChanges";
import { restoreNode, updateChangeChildrenAttributes } from "./engine/updateAttributes";
import { ChangeSet } from "./ChangeSet";
import { excludeFromTracked } from "./helpers";
import { deleteNode } from "./lib/deleteNode";
import { clearTextChange } from "./lib/clearTextChange";
import { rejectMove } from "./engine/moveIdentity";
import { mergeNode } from "./lib/mergeNode";
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs, TrackedChange } from "./types";

function collectMoveNodeIds(containerNode: PMNode, primaryMoveNodeId: string): Set<string> {
  const moveNodeIds = new Set<string>();
  moveNodeIds.add(primaryMoveNodeId);
  containerNode.descendants((childNode: PMNode) => {
    const dataTracked = childNode.attrs.dataTracked;
    if (Array.isArray(dataTracked)) {
      dataTracked.forEach((trackingData: { moveNodeId?: string }) => {
        if (trackingData.moveNodeId) moveNodeIds.add(trackingData.moveNodeId);
      });
    }
  });
  return moveNodeIds;
}

/**
 * Whether anything of a change is left after the steps in `deleteMap`. A text
 * record can outlive its first characters: rejecting an insertion takes away
 * whatever part of a deletion was stacked on it, not the rest.
 */
function isEntirelyGone(change: TrackedChange, deleteMap: Mapping) {
  const { pos, deleted } = deleteMap.mapResult(change.from);
  const spansText = ChangeSet.isTextChange(change) || ChangeSet.isInlineMarkChange(change);
  return deleted && !(spansText && deleteMap.map(change.to, -1) > pos);
}

/**
 * Applies accepted/rejected changes to the document and clears tracking metadata.
 */
export function applyChanges(
  tr: Transaction,
  schema: Schema,
  changes: TrackedChange[],
  changeSet: ChangeSet,
  deleteMap = new Mapping(),
) {
  // node-attr-change first; list changes last (lift before paragraph child changes)
  changes.sort((c1, c2) => {
    if (
      (c1.type === "node-change" && c1.node.type === schema.nodes.list) ||
      (c2.type === "node-change" && c2.node.type === schema.nodes.list)
    ) {
      return 1;
    }
    return c1.dataTracked.updatedAt - c2.dataTracked.updatedAt;
  });

  // ── First pass — everything except move/structure ──────────────────────────
  changes.forEach(change => {
    if (
      change.dataTracked.operation === CHANGE_OPERATION.move ||
      change.dataTracked.operation === CHANGE_OPERATION.structure
    ) return;

    if (
      change.dataTracked.operation === CHANGE_OPERATION.delete &&
      change.dataTracked.moveNodeId
    ) return;

    // Joining reshapes the blocks around it, so it settles after everything else.
    if (
      change.dataTracked.operation === CHANGE_OPERATION.node_join &&
      change.dataTracked.status === CHANGE_STATUS.accepted
    ) return;

    const from = deleteMap.map(change.from);
    const node = tr.doc.nodeAt(from);
    const noChangeNeeded = !ChangeSet.shouldDeleteChange(change);

    if (isEntirelyGone(change, deleteMap)) return;
    if (!node) {
      console.warn("No node found to update for change", change);
      return;
    }

    if (
      change.dataTracked.status === CHANGE_STATUS.rejected &&
      change.dataTracked.operation === CHANGE_OPERATION.wrap_with_node
    ) {
      return revertWrapNodeChange(tr, change, deleteMap);
    }

    if (ChangeSet.isTextChange(change) && noChangeNeeded) {
      clearTextChange(tr, from, deleteMap.map(change.to), change.id);
    } else if (ChangeSet.isTextChange(change)) {
      tr.delete(from, deleteMap.map(change.to));
      deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
    } else if (ChangeSet.isNodeChange(change) && noChangeNeeded) {
      const attrs = { ...node.attrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id) };
      tr.setNodeMarkup(from, undefined, attrs, node.marks);
      if (node.isAtom) {
        clearTextChange(tr, from, deleteMap.map(change.to), change.id);
      }
      updateChangeChildrenAttributes(change.children, tr, deleteMap);
    } else if (ChangeSet.isNodeChange(change)) {
      const merged = mergeNode(node, from, tr);
      if (merged === undefined) deleteNode(node, from, tr);
      deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.accepted) {
      tr.setNodeMarkup(
        from, undefined,
        { ...change.newAttrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id) },
        node.marks,
      );
    } else if (ChangeSet.isNodeAttrChange(change) && change.dataTracked.status === CHANGE_STATUS.rejected) {
      const oldTypeName = "oldNodeTypeName" in change.dataTracked ? change.dataTracked.oldNodeTypeName : undefined;
      const oldType = oldTypeName ? node.type.schema.nodes[oldTypeName] : undefined;
      tr.setNodeMarkup(
        from, oldType,
        { ...change.oldAttrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id) },
        node.marks,
      );
    } else if (ChangeSet.isReferenceChange(change)) {
      tr.setNodeMarkup(
        from, undefined,
        { ...node.attrs, dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id) },
        node.marks,
      );
    } else if (ChangeSet.isMarkChange(change)) {
      // The mark keeps what it says — a colour, a size, a link — and loses only this record.
      const newMark = change.mark.type.create({
        ...change.mark.attrs,
        dataTracked: excludeFromTracked(change.mark.attrs.dataTracked, change.id),
      });
      const isInsert = change.dataTracked.operation === CHANGE_OPERATION.insert;
      const isDelete = change.dataTracked.operation === CHANGE_OPERATION.delete;
      const toBeRestored =
        (change.dataTracked.status === CHANGE_STATUS.accepted && isInsert) ||
        (change.dataTracked.status === CHANGE_STATUS.rejected && isDelete);

      if (ChangeSet.isInlineMarkChange(change)) {
        const to = deleteMap.map(change.to);
        tr.removeMark(from, to, change.mark);
        if (toBeRestored) tr.addMark(from, to, newMark);
      } else {
        tr.removeNodeMark(from, change.mark);
        if (toBeRestored) tr.addNodeMark(from, newMark);
      }
    }
  });

  // ── Second pass — move/structure ───────────────────────────────────────────
  changes.forEach(change => {
    if (
      change.dataTracked.operation !== CHANGE_OPERATION.move &&
      change.dataTracked.operation !== CHANGE_OPERATION.structure
    ) return;

    if (change.type === "node-change" && change.dataTracked.operation === CHANGE_OPERATION.move &&
        change.dataTracked.status === CHANGE_STATUS.rejected) {
      rejectMove(tr, change, deleteMap);
      return;
    }

    const { pos: from, deleted } = deleteMap.mapResult(change.from);
    const node = tr.doc.nodeAt(from);

    if (deleted || !node) {
      if (!deleted && !node) console.warn("No node found for move change", { change });
      return;
    }

    if (change.dataTracked.status === CHANGE_STATUS.accepted) {
      const attrs = {
        ...node.attrs,
        dataTracked: excludeFromTracked(node.attrs.dataTracked, change.id),
      };
      tr.setNodeMarkup(from, undefined, attrs, node.marks);

      const originalChanges = changeSet.changes.filter(
        c =>
          c.dataTracked.moveNodeId === change.dataTracked.moveNodeId &&
          c.dataTracked.operation === CHANGE_OPERATION.delete,
      );

      if (originalChanges.length === 0) {
        console.warn("No original change found for move operation", { change });
      }

      originalChanges.forEach(originalChange => {
        if (isEntirelyGone(originalChange, deleteMap)) return;
        const originalFrom = deleteMap.map(originalChange.from);
        const originalNode = tr.doc.nodeAt(originalFrom);
        if (originalNode) {
          // A text record can span several text nodes; a node's record is the node.
          const originalTo = ChangeSet.isTextChange(originalChange)
            ? deleteMap.map(originalChange.to, -1)
            : originalFrom + originalNode.nodeSize;
          tr.delete(originalFrom, originalTo);
          deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
        }
      });
    } else if (change.dataTracked.status === CHANGE_STATUS.rejected) {
      const moveNodeIdsToRestore = collectMoveNodeIds(node, change.dataTracked.moveNodeId!);

      tr.delete(from, from + node.nodeSize);
      deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());

      changeSet.changes
        .filter(
          c =>
            c.dataTracked.operation === CHANGE_OPERATION.delete &&
            c.dataTracked.moveNodeId &&
            moveNodeIdsToRestore.has(c.dataTracked.moveNodeId) &&
            ChangeSet.isNodeChange(c),
        )
        .forEach(orig => {
          const { pos } = deleteMap.mapResult(orig.from);
          const node = tr.doc.nodeAt(pos);
          if (!node) return;

          const dataTracked = node.attrs.dataTracked || [];
          const hasMoved = dataTracked.some(
            (d: TrackedAttrs) =>
              d.operation === CHANGE_OPERATION.move && d.status === CHANGE_STATUS.pending,
          );

          if (hasMoved) {
            tr.delete(pos, pos + node.nodeSize);
            deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
            return;
          }

          restoreNode(tr, node, pos, orig.id);
        });
    }
  });

  return deleteMap;
}
