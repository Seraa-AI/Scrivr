import { Fragment, Node as PMNode, Slice } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";

import { TrackChangesAction } from "../actions";
import { findChanges } from "../findChanges";
import {
  addTrackIdIfDoesntExist,
  createNewInsertAttrs,
  createNewStructureAttrs,
  getBlockInlineTrackedData,
  NewEmptyAttrs,
  updateBlockNodesAttrs,
} from "../helpers";
import { cutFragment, setFragmentAsInserted } from "./fragments";
import { ChangeStep, ExposedSlice, InsertSliceStep, NodeChange } from "../types";
import { updateChangeAttrs } from "../engine/updateAttributes";
import { CHANGE_OPERATION } from "../types";
import { matchInserted } from "./mergeTrackedMarks";

/** Remove the copy of a structure change that was set as delete with moveNodeId. */
export const dropStructuralChangeShadow = (moveNodeId: string | undefined, tr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: tr.doc }));
  const changes = changeSet.changes.filter(
    c => c.type === "node-change" && c.dataTracked.moveNodeId === moveNodeId,
  );
  const shadow = changes.filter(c => c.dataTracked.operation === CHANGE_OPERATION.delete);
  const structures = changes.filter(c => c.dataTracked.operation === CHANGE_OPERATION.structure) as NodeChange[];

  structures.map(c => {
    tr.setNodeMarkup(c.from, undefined, { ...c.node.attrs, dataTracked: null });
  });

  if (shadow.length > 0) {
    tr.delete(shadow[0]!.from, shadow[shadow.length - 1]!.to);
  }
  return tr;
};

/**
 * Checks changes that have been paired with other changes (structure, move, split).
 * Converts orphaned main changes to inserts and removes paired changes without connections.
 */
export const dropOrphanChanges = (newTr: Transaction) => {
  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }));
  const shadowIds = new Set();
  const referenceIds = new Set();
  const changesIds = new Set();

  changeSet.changes.forEach(c => {
    if (c.dataTracked.moveNodeId && c.dataTracked.operation === CHANGE_OPERATION.delete) {
      shadowIds.add(c.dataTracked.moveNodeId);
    }
    if (
      c.dataTracked.operation === CHANGE_OPERATION.structure ||
      c.dataTracked.operation === CHANGE_OPERATION.move
    ) {
      changesIds.add(c.dataTracked.moveNodeId);
    }
    if (c.dataTracked.operation === CHANGE_OPERATION.node_split) {
      changesIds.add(c.dataTracked.id);
    }
    if (c.dataTracked.operation === CHANGE_OPERATION.reference) {
      referenceIds.add(c.dataTracked.referenceId);
    }
  });

  if (!shadowIds.size && !referenceIds.size && !changesIds.size) return;

  changeSet.changes.forEach(c => {
    if (
      c.dataTracked.operation === CHANGE_OPERATION.reference &&
      !changesIds.has(c.dataTracked.referenceId)
    ) {
      const node = newTr.doc.nodeAt(c.from);
      const dataTracked =
        node && (getBlockInlineTrackedData(node) || []).filter(d => d.id !== c.id);
      newTr.setNodeMarkup(c.from, undefined, { ...node?.attrs, dataTracked });
    }

    if (
      c.type === "node-change" &&
      c.dataTracked.operation === CHANGE_OPERATION.node_split &&
      !referenceIds.has(c.id)
    ) {
      const { id, ...attrs } = c.dataTracked;
      newTr.replaceWith(
        c.from,
        c.to,
        setFragmentAsInserted(Fragment.from(c.node), createNewInsertAttrs(attrs), newTr.doc.type.schema),
      );
      const referenceChanges = (getBlockInlineTrackedData(c.node) || []).filter(
        d => d.operation === CHANGE_OPERATION.reference,
      );
      if (referenceChanges.length) {
        const node = newTr.doc.nodeAt(c.from);
        const dataTracked = (node && getBlockInlineTrackedData(node)) || [];
        newTr.setNodeMarkup(c.from, undefined, {
          ...node?.attrs,
          dataTracked: [...dataTracked, ...referenceChanges],
        });
      }
    }

    if (
      c.dataTracked.moveNodeId &&
      !(shadowIds.has(c.dataTracked.moveNodeId) && changesIds.has(c.dataTracked.moveNodeId))
    ) {
      if (c.dataTracked.operation === CHANGE_OPERATION.delete) {
        if (c.type === "text-change") {
          newTr.removeMark(c.from, c.to, newTr.doc.type.schema.marks.tracked_delete);
        } else if (c.type === "node-change") {
          newTr.setNodeMarkup(c.from, undefined, { ...c.node.attrs, dataTracked: null });
        }
      } else if (c.type === "node-change") {
        const { id, moveNodeId, ...attrs } = c.dataTracked;
        newTr.replaceWith(
          c.from,
          c.to,
          setFragmentAsInserted(
            Fragment.from(c.node),
            createNewInsertAttrs(attrs),
            newTr.doc.type.schema,
          ),
        );
      }
    }
  });
};

const groupStructureChanges = (tr: Transaction, toNode: PMNode | null) => {
  const moveNodeIds = new Set<string>();
  const [insertStep, deleteStep] = tr.steps as ReplaceStep[];
  const fromNodes = tr.docs[1]!.slice(deleteStep!.from, deleteStep!.to).content;

  Fragment.from(toNode)
    .append(insertStep!.slice.content)
    .append(fromNodes)
    .descendants(node => {
      const moveNodeId = (getBlockInlineTrackedData(node) || []).find(
        c => c.operation === CHANGE_OPERATION.structure,
      )?.moveNodeId;
      moveNodeId && moveNodeIds.add(moveNodeId);
    });

  return moveNodeIds;
};

/** Joins other structural changes in the range of transaction steps to the new change moveNodeId. */
export const joinStructureChanges = (
  attrs: NewEmptyAttrs,
  sliceContent: Fragment,
  content: Fragment,
  tr: Transaction,
  newTr: Transaction,
) => {
  const moveNodeId = attrs.moveNodeId;
  let toNode: PMNode | null = tr.docs[0]!.resolve((tr.steps[0] as ReplaceStep).from).node();
  toNode = toNode?.type.spec.attrs?.dataTracked ? toNode : null;

  const idsSet = groupStructureChanges(tr, toNode);
  const changeSet = findChanges(EditorState.create({ doc: newTr.doc }));

  const relatedChanges = changeSet.changes.filter(
    c => c.dataTracked.moveNodeId && idsSet.has(c.dataTracked.moveNodeId),
  );
  relatedChanges.map(c =>
    updateChangeAttrs(newTr, c, { ...c.dataTracked, ...(moveNodeId !== undefined ? { moveNodeId } : {}) }, newTr.doc.type.schema),
  );

  const toInsertChange =
    toNode && getBlockInlineTrackedData(toNode)?.find(c => c.operation === CHANGE_OPERATION.insert);
  const fromInsertChange =
    sliceContent.firstChild &&
    getBlockInlineTrackedData(sliceContent.firstChild)?.find(c => c.operation === CHANGE_OPERATION.insert);

  if (toInsertChange || fromInsertChange) {
    return setFragmentAsInserted(content, createNewInsertAttrs(attrs), newTr.doc.type.schema);
  }

  return updateBlockNodesAttrs(sliceContent, (_, _node) => ({
    ..._,
    dataTracked: [addTrackIdIfDoesntExist(createNewStructureAttrs({ ...attrs, ...(moveNodeId !== undefined ? { moveNodeId } : {}) }))],
  }));
};

export const isStructuralChange = (tr: Transaction) =>
  tr.getMeta(TrackChangesAction.structuralChangeAction) &&
  tr.steps.length === 2 &&
  tr.steps[0] instanceof ReplaceStep &&
  tr.steps[1] instanceof ReplaceStep;

/** Finds text changes that overlap and creates a single change for them. */
export function diffChangeSteps(steps: ChangeStep[]) {
  const deleted = steps.filter(s => s.type !== "insert-slice");
  const inserted = steps.filter(s => s.type === "insert-slice") as InsertSliceStep[];

  const updated: ChangeStep[] = [];
  let updatedDeleted: ChangeStep[] = [...deleted];

  inserted.forEach(ins => {
    if (ins.sliceWasSplit) {
      updated.push(ins);
      return;
    }
    const deleteStart = updatedDeleted.reduce((acc, cur) => {
      if (cur.type === "delete-node") return Math.min(acc, cur.pos);
      else if (cur.type === "delete-text") return Math.min(acc, cur.from);
      return acc;
    }, Number.MAX_SAFE_INTEGER);

    const [matchedDeleted, updatedDel] = matchInserted(deleteStart, updatedDeleted, ins.slice.content);
    if (matchedDeleted === deleteStart) {
      updated.push(ins);
      return;
    }
    updatedDeleted = updatedDel;
    const [, newInserted] = cutFragment(0, matchedDeleted - deleteStart, ins.slice.content);
    if (newInserted.size > 0) {
      updated.push({ ...ins, slice: new Slice(newInserted, ins.slice.openStart, ins.slice.openEnd) as ExposedSlice });
    }
  });

  return [...updatedDeleted, ...updated];
}
