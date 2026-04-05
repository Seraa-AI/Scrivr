import { Node as PMNode } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { ReplaceAroundStep } from "prosemirror-transform";

import { NewEmptyAttrs } from "../helpers";
import { ChangeStep } from "../types";

/**
 * Tracks a setNodeMarkup operation (node type or attrs change).
 *
 * ReplaceAroundStep produced by setNodeMarkup has `structure: true` and a gap
 * spanning the node's inner content. trackReplaceAroundStep can't handle it —
 * it tries to insert the new wrapper inside the gap, which is invalid. Instead,
 * we invert the step to restore the original node and return an update-node-attrs
 * ChangeStep that processChangeSteps applies via setNodeMarkup.
 *
 * Returns [] when nothing meaningful changed (only bookkeeping fields like
 * dataTracked/nodeId differ) or when the inverted step fails to apply.
 */
export function trackSetNodeMarkupStep(
  step: ReplaceAroundStep,
  newTr: Transaction,
  _attrs: NewEmptyAttrs,
  currentDoc: PMNode,
): ChangeStep[] {
  const currentNode = currentDoc.nodeAt(step.from);
  const newNode = step.slice.content.firstChild;
  if (!currentNode || !newNode) return [];

  // Strip internal bookkeeping before comparing so nodeId/dataTracked
  // assignments don't generate spurious tracking entries.
  const { dataTracked: _a, nodeId: _b, ...oldMeaningful } = currentNode.attrs as Record<string, unknown>;
  const { dataTracked: _c, nodeId: _d, ...newMeaningful } = newNode.attrs as Record<string, unknown>;
  const typeChanged = currentNode.type !== newNode.type;

  if (!typeChanged && JSON.stringify(oldMeaningful) === JSON.stringify(newMeaningful)) {
    return [];
  }

  const inverted = step.invert(currentDoc);
  if (newTr.maybeStep(inverted).failed) return [];

  const { dataTracked: _dt, nodeId, ...currentAttrs } = currentNode.attrs as Record<string, unknown>;
  const { dataTracked: _dt2, nodeId: _nid, ...sliceAttrs } = newNode.attrs as Record<string, unknown>;

  // For type changes: use only the new type's attrs (avoid leaking attrs like
  // `level` from heading into paragraph). For attr-only changes: merge so that
  // unset attrs keep their existing values.
  const newAttrs = typeChanged
    ? { ...sliceAttrs, nodeId }
    : { ...currentAttrs, ...sliceAttrs, nodeId };

  return [{
    pos: step.from,
    type: "update-node-attrs",
    node: currentNode,
    newAttrs,
    ...(typeChanged ? { newNodeType: newNode.type } : {}),
  }];
}
