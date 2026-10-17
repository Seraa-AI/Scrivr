import { Schema } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { Mapping, ReplaceStep } from "@scrivr/core/pm";

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
import { ChangeStep, CHANGE_OPERATION, CHANGE_STATUS, UpdateAttrs } from "../types";

export function processChangeSteps(
  changes: ChangeStep[],
  newTr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  schema: Schema,
) {
  const mapping = new Mapping();
  const deleteAttrs = createNewDeleteAttrs(emptyAttrs);
  let selectionPos = undefined;
  const removedNodes: Array<{ from: number; to: number }> = [];
  const retainedNodes: Array<{ from: number; to: number }> = [];

  changes.forEach(c => {
    // A physically removed ancestor consumed its descendants. A retained
    // proposal did not, regardless of whether it carries insertion records.
    if ((c.type === "delete-node" || c.type === "delete-text") &&
        removedNodes.some(range => range.from <= c.pos &&
          (c.type === "delete-node" ? c.nodeEnd : c.to) <= range.to)) return;
    let step = newTr.steps[newTr.steps.length - 1];
    switch (c.type) {
      case "delete-node": {
        const beforeSteps = newTr.steps.length;
        const allowCancellation = !retainedNodes.some(range => range.from <= c.pos && c.nodeEnd <= range.to);
        const removed = deleteOrSetNodeDeleted(c.node, mapping.map(c.pos), newTr, deleteAttrs, allowCancellation);
        if (removed) removedNodes.push({ from: c.pos, to: c.nodeEnd });
        else retainedNodes.push({ from: c.pos, to: c.nodeEnd });
        for (let i = beforeSteps; i < newTr.steps.length; i++) {
          mapping.appendMap(newTr.steps[i]!.getMap());
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
          !retainedNodes.some(range => range.from <= c.pos && c.to <= range.to),
        );

        const textNewestStep = newTr.steps[newTr.steps.length - 1];
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
