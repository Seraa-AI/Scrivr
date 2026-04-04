import { Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { Mapping, ReplaceStep } from "prosemirror-transform";

import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewUpdateAttrs,
  getBlockInlineTrackedData,
  NewEmptyAttrs,
} from "../helpers";
import { deleteOrSetNodeDeleted } from "../lib/deleteNode";
import { deleteTextIfInserted } from "../lib/deleteTextIfInserted";
import { mergeTrackedMarks } from "../lib/mergeTrackedMarks";
import { ChangeStep, DeleteNodeStep, CHANGE_OPERATION, CHANGE_STATUS, UpdateAttrs } from "../types";

export function processChangeSteps(
  changes: ChangeStep[],
  newTr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  schema: Schema,
  deletedNodeMapping: Mapping,
) {
  const mapping = new Mapping();
  const deleteAttrs = createNewDeleteAttrs(emptyAttrs);
  let selectionPos = undefined;
  let deletesCounter = 0;
  let isInserted = false;
  let prevDelete: DeleteNodeStep;

  changes.forEach(c => {
    let step = newTr.steps[newTr.steps.length - 1];
    switch (c.type) {
      case "delete-node": {
        deletesCounter++;
        const prevDeletedNodeInserted = isInserted;
        const trackedData = getBlockInlineTrackedData(c.node);
        const inserted = trackedData?.find(
          d =>
            d.operation === CHANGE_OPERATION.insert ||
            d.operation === CHANGE_OPERATION.wrap_with_node,
        );
        const structure = trackedData?.find(
          c =>
            c.operation === CHANGE_OPERATION.structure &&
            deleteAttrs.moveNodeId &&
            c.moveNodeId !== deleteAttrs.moveNodeId,
        );
        let childOfDeleted = false;
        if (prevDelete) {
          prevDelete.node.descendants(node => {
            if (childOfDeleted) {
              return false;
            }
            if (node == c.node) {
              childOfDeleted = true;
            }
          });
        }

        const isMoveOperation = !!emptyAttrs.moveNodeId;
        if (
          (prevDelete &&
            c.pos < prevDelete.nodeEnd &&
            isInserted &&
            deletesCounter > 1 &&
            !isMoveOperation) ||
          (childOfDeleted && prevDeletedNodeInserted)
        ) {
          return false;
        }

        deleteOrSetNodeDeleted(c.node, mapping.map(c.pos), newTr, deleteAttrs);
        prevDelete = c;
        isInserted = !!inserted || !!structure || (!trackedData && isInserted);

        const newestStep = newTr.steps[newTr.steps.length - 1];
        if (isInserted || structure) {
          deletedNodeMapping.appendMap(newestStep!.getMap());
        }
        if (step !== newestStep) {
          mapping.appendMap(newestStep!.getMap());
          step = newestStep;
        }

        mergeTrackedMarks(mapping.map(c.pos), newTr.doc, newTr, schema);

        break;
      }
      case "insert-slice": {
        const newStep = new ReplaceStep(
          mapping.map(c.from),
          mapping.map(c.to),
          c.slice,
          false,
        );
        const stepResult = newTr.maybeStep(newStep);
        if (stepResult.failed) {
          console.error(
            `processChangeSteps: insert-slice ReplaceStep failed "${stepResult.failed}"`,
            newStep,
          );
          return;
        }
        mergeTrackedMarks(mapping.map(c.from), newTr.doc, newTr, schema);
        const to = mapping.map(c.to) + c.slice.size;
        mergeTrackedMarks(
          mapping.map(c.to) + (to < newTr.doc.nodeSize ? c.slice.size : 0),
          newTr.doc,
          newTr,
          schema,
        );
        selectionPos = mapping.map(c.to) + c.slice.size;
        break;
      }
      case "delete-text": {
        const node = newTr.doc.nodeAt(mapping.map(c.pos));
        if (!node) {
          console.error(
            `processChangeSteps: no text node found for text-change`,
            c,
          );
          return;
        }

        const where = deleteTextIfInserted(
          node,
          mapping.map(c.pos),
          newTr,
          schema,
          deleteAttrs,
          mapping.map(c.from),
          mapping.map(c.to),
        );

        const textNewestStep = newTr.steps[newTr.steps.length - 1];

        if (node.marks.find(m => m.type === schema.marks.tracked_insert)) {
          deletedNodeMapping.appendMap(textNewestStep!.getMap());
        }

        if (step !== textNewestStep) {
          mapping.appendMap(textNewestStep!.getMap());
          step = textNewestStep;
        }
        mergeTrackedMarks(where, newTr.doc, newTr, schema);
        break;
      }
      case "merge-fragment": {
        let insertPos = mapping.map(c.mergePos);
        if (c.node.isText) {
          insertPos = deleteTextIfInserted(
            c.node,
            mapping.map(c.pos),
            newTr,
            schema,
            deleteAttrs,
            mapping.map(c.from),
            mapping.map(c.to),
          );
          const newestStep = newTr.steps[newTr.steps.length - 1];

          if (c.node.marks.find(m => m.type === schema.marks.tracked_insert)) {
            deletedNodeMapping.appendMap(newestStep!.getMap());
          }

          if (step !== newestStep) {
            mapping.appendMap(newestStep!.getMap());
            step = newestStep;
          }
        }
        if (c.fragment.size > 0) {
          newTr.insert(insertPos, c.fragment);
        }
        break;
      }
      case "update-node-attrs": {
        const oldDataTracked = getBlockInlineTrackedData(c.node) || [];
        const oldUpdate = oldDataTracked.reverse().find(d => {
          if (
            d.operation === CHANGE_OPERATION.set_node_attributes &&
            d.status === CHANGE_STATUS.pending
          ) {
            return true;
          }
          return false;
        }) as UpdateAttrs;

        const { dataTracked, ...restAttrs } = c.node.attrs;
        const oldAttrs = restAttrs;
        const newDataTracked = [
          ...oldDataTracked.filter(d => !oldUpdate || d.id !== oldUpdate.id),
        ];
        const newUpdate =
          oldUpdate && oldUpdate.status !== CHANGE_STATUS.rejected
            ? {
                ...oldUpdate,
                updatedAt: emptyAttrs.updatedAt,
              }
            : {
                ...addTrackIdIfDoesntExist(createNewUpdateAttrs(emptyAttrs, c.node.attrs)),
                // Record original node type for type changes (ul↔ol, p↔h, etc.)
                // so that rejection can pass the right type to setNodeMarkup.
                ...(c.newNodeType ? { oldNodeTypeName: c.node.type.name } : {}),
              };
        if (
          (JSON.stringify(oldAttrs) !== JSON.stringify(c.newAttrs) ||
            c.newNodeType !== undefined ||
            c.node.type === c.node.type.schema.nodes.citation) &&
          !oldDataTracked.find(
            d =>
              (d.operation === CHANGE_OPERATION.insert ||
                d.operation === CHANGE_OPERATION.wrap_with_node) &&
              d.status === CHANGE_STATUS.pending,
          )
        ) {
          newDataTracked.push(newUpdate);
        }

        const finalDataTracked =
          newDataTracked.length > 0 ? newDataTracked : oldDataTracked;

        newTr.setNodeMarkup(
          mapping.map(c.pos),
          c.newNodeType ?? c.node.type,
          {
            ...c.newAttrs,
            dataTracked: finalDataTracked.length > 0 ? finalDataTracked : null,
          },
          c.node.marks,
        );
        break;
      }
      default: {
        console.error(`processChangeSteps: unknown change step type"`, c);
        return;
      }
    }
  });

  return [mapping, selectionPos] as [Mapping, number | undefined];
}
