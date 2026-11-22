import { Node as PMNode } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { AttrStep, type Mapping } from "@scrivr/core/pm";

import { stableStringify } from "@scrivr/core";

import { getBlockInlineTrackedData, isTrackedRecord, NewEmptyAttrs } from "../helpers";
import { ChangeStep, UpdateNodeAttrsStep } from "../types";

function trackAttrsChangeStep(
  step: AttrStep,
  _oldState: EditorState,
  _tr: Transaction,
  newTr: Transaction,
  attrs: NewEmptyAttrs,
  currentStepDoc: PMNode,
  replayBridge: Mapping,
): ChangeStep[] {
  if (step.attr === "dataTracked") {
    // Taking back one's own records is review bookkeeping, as taking off one's
    // review mark is: it stands, with nothing to record. Another author's
    // records are theirs to withdraw, so rewriting them is undone.
    const node = currentStepDoc.nodeAt(step.pos);
    if (!node || !withdrawsOwnRecords(node, step.value, attrs.authorID)) {
      const undo = step.invert(currentStepDoc).map(replayBridge);
      if (undo) newTr.maybeStep(undo);
    }
    return [];
  }
  const newStep = step.invert(currentStepDoc).map(replayBridge);
  if (!newStep) return [];
  const stepResult = newTr.maybeStep(newStep);
  if (stepResult.failed) {
    console.error(
      `inverting ReplaceAroundStep failed: "${stepResult.failed}"`,
      newStep,
    );
    return [];
  }
  const node = currentStepDoc.nodeAt(step.pos);

  if (!node) {
    return [];
  }

  const { dataTracked, ...newAttrs } = node.attrs || {};

  const changeStep: UpdateNodeAttrsStep = {
    pos: replayBridge.map(step.pos, 1),
    type: "update-node-attrs",
    node,
    newAttrs: {
      ...newAttrs,
      [step.attr]: step.value,
    },
  };

  return [changeStep];
}

/**
 * Whether `records`, written over `node`'s, only drops some of `authorID`'s:
 * every record left stands exactly as it was.
 */
function withdrawsOwnRecords(node: PMNode, records: unknown, authorID: string): boolean {
  const before = new Map((getBlockInlineTrackedData(node) ?? []).map((record) => [record.id, record]));
  const after = (Array.isArray(records) ? records : [records]).filter(isTrackedRecord);
  const kept = new Set(after.map((record) => record.id));
  return (
    after.every((record) => {
      const old = record.id === undefined ? undefined : before.get(record.id);
      return old !== undefined && stableStringify(old) === stableStringify(record);
    }) &&
    [...before.values()].every((record) => kept.has(record.id) || record.authorID === authorID)
  );
}

export default trackAttrsChangeStep;
