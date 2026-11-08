import { Node as PMNode } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { AttrStep, type Mapping } from "@scrivr/core/pm";

import { NewEmptyAttrs } from "../helpers";
import { ChangeStep, UpdateNodeAttrsStep } from "../types";

function trackAttrsChangeStep(
  step: AttrStep,
  _oldState: EditorState,
  _tr: Transaction,
  newTr: Transaction,
  _attrs: NewEmptyAttrs,
  currentStepDoc: PMNode,
  replayBridge: Mapping,
): ChangeStep[] {
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

export default trackAttrsChangeStep;
