import { Node as PMNode } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { AttrStep, type Mapping } from "@scrivr/core/pm";

import { stableStringify } from "@scrivr/core";

import { getBlockInlineTrackedData, isTrackedRecord, NewEmptyAttrs, ownedBy, type Owner } from "../helpers";
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
    if (!node || !withdrawsOwnRecords(node, step.value, attrs)) {
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
 * every record left stands exactly as it was. Records are matched whole, since
 * one read from a saved document may carry no id.
 */
function withdrawsOwnRecords(node: PMNode, records: unknown, owner: Owner): boolean {
  const before = getBlockInlineTrackedData(node) ?? [];
  const dropped = before.map((record) => stableStringify(record));
  for (const record of (Array.isArray(records) ? records : [records]).filter(isTrackedRecord)) {
    const at = dropped.indexOf(stableStringify(record));
    if (at < 0) return false;
    dropped.splice(at, 1);
  }
  return before.every((record) => !dropped.includes(stableStringify(record)) || ownedBy(record, owner));
}

export default trackAttrsChangeStep;
