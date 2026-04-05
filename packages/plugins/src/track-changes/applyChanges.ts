import { Node as PMNode, Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";

import { revertSplitNodeChange, revertWrapNodeChange } from "./lib/revertChanges";
import { restoreNode, updateChangeChildrenAttributes } from "./engine/updateAttributes";
import { ChangeSet } from "./ChangeSet";
import { excludeFromTracked } from "./helpers";
import { deleteNode, keepPairedChanges } from "./lib/deleteNode";
import { mergeNode } from "./lib/mergeNode";
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs, TrackedChange, UpdateAttrs } from "./types";

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

    const { pos: from, deleted } = deleteMap.mapResult(change.from);
    const node = tr.doc.nodeAt(from);
    const noChangeNeeded = !ChangeSet.shouldDeleteChange(change);

    if (deleted) return;
    if (!node) {
      !deleted && console.warn("No node found to update for change", change);
      return;
    }

    if (change.dataTracked.status === CHANGE_STATUS.rejected) {
      if (change.dataTracked.operation === CHANGE_OPERATION.node_split) {
        return revertSplitNodeChange(tr, change, changeSet);
      }
      if (change.dataTracked.operation === CHANGE_OPERATION.wrap_with_node) {
        return revertWrapNodeChange(tr, change, deleteMap);
      }
    }

    if (ChangeSet.isTextChange(change) && noChangeNeeded) {
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_insert);
      tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_delete);
    } else if (ChangeSet.isTextChange(change)) {
      tr.delete(from, deleteMap.map(change.to));
      deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
    } else if (ChangeSet.isNodeChange(change) && noChangeNeeded) {
      const attrs = { ...node.attrs, dataTracked: keepPairedChanges(node) };
      tr.setNodeMarkup(from, undefined, attrs, node.marks);
      if (node.isAtom) {
        tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_insert);
        tr.removeMark(from, deleteMap.map(change.to), schema.marks.tracked_delete);
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
      const oldTypeName = (change.dataTracked as UpdateAttrs).oldNodeTypeName;
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
      const newMark = change.mark.type.create({
        dataTracked: excludeFromTracked(change.mark.attrs.dataTracked, change.id),
      });
      const isInsert = change.dataTracked.operation === CHANGE_OPERATION.insert;
      const isDelete = change.dataTracked.operation === CHANGE_OPERATION.delete;
      const toBeRestored =
        (change.dataTracked.status === CHANGE_STATUS.accepted && isInsert) ||
        (change.dataTracked.status === CHANGE_STATUS.rejected && isDelete);

      if (ChangeSet.isInlineMarkChange(change)) {
        tr.removeMark(change.from, change.to, change.mark);
        if (toBeRestored) tr.addMark(change.from, change.to, newMark);
      } else {
        tr.removeNodeMark(change.from, change.mark);
        if (toBeRestored) tr.addNodeMark(change.from, newMark);
      }
    }
  });

  // ── Second pass — move/structure ───────────────────────────────────────────
  changes.forEach(change => {
    if (
      change.dataTracked.operation !== CHANGE_OPERATION.move &&
      change.dataTracked.operation !== CHANGE_OPERATION.structure
    ) return;

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
        const { pos: originalFrom, deleted } = deleteMap.mapResult(originalChange.from);
        if (deleted) return;
        const originalNode = tr.doc.nodeAt(originalFrom);
        if (originalNode) {
          tr.delete(originalFrom, originalFrom + originalNode.nodeSize);
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

          restoreNode(tr, node, pos, schema);
        });
    }
  });

  return deleteMap;
}
