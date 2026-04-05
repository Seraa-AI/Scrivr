import { Node as PMNode, Slice } from "prosemirror-model";
import { Selection } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";

import { ChangeSet } from "../ChangeSet";
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from "../types";

export const isDeleteStep = (step: ReplaceStep) =>
  step.from !== step.to && step.slice.content.size < step.to - step.from;

export const isSplitStep = (
  step: ReplaceStep,
  selection: Selection,
  uiEvent: string,
) => {
  const { from, to, slice } = step;

  if (
    from !== to ||
    slice.content.childCount < 2 ||
    (slice.content.firstChild?.isInline && slice.content.lastChild?.isInline)
  ) {
    return false;
  }

  const {
    $anchor: { parentOffset: startOffset },
    $head: { parentOffset: endOffset },
    $from,
  } = selection;
  const parentSize = $from.node().content.size;

  if (uiEvent === "paste") {
    return !(
      (startOffset === 0 && endOffset === 0) ||
      (startOffset === parentSize && endOffset === parentSize)
    );
  }
  const {
    content: { firstChild, lastChild },
    openStart,
    openEnd,
  } = slice;

  if (
    (uiEvent === "Enter" || uiEvent === "NumpadEnter") &&
    firstChild?.type.name === "list_item"
  ) {
    return (
      !(parentSize === startOffset && parentSize === endOffset) &&
      lastChild?.type.name === "list_item"
    );
  }

  return (
    openStart === openEnd &&
    firstChild!.type === lastChild!.type &&
    firstChild!.inlineContent &&
    lastChild!.inlineContent &&
    !(startOffset === parentSize && endOffset === parentSize)
  );
};

export const isWrapStep = (step: ReplaceAroundStep) =>
  step.from === step.gapFrom &&
  step.to === step.gapTo &&
  step.slice.openStart === 0 &&
  step.slice.openEnd === 0;

/**
 * Returns true when the ReplaceAroundStep was produced by setNodeMarkup —
 * i.e. it changes a node's type or attributes while preserving its inner
 * content verbatim. Examples: heading level change (h1→h2), paragraph
 * alignment change when expressed as a full node replacement.
 *
 * Shape: structure=true, gap spans exactly the inner content (gapFrom = from+1,
 * gapTo = to-1), and the slice contains the new node wrapper.
 */
export const isSetNodeMarkupStep = (step: ReplaceAroundStep): boolean => {
  const { from, to, gapFrom, gapTo } = step;
  // `structure` is set by ProseMirror internals but not in the public type.
  const structure = (step as unknown as { structure?: boolean }).structure;
  return !!(structure && gapFrom === from + 1 && gapTo === to - 1);
};

export const isLiftStep = (step: ReplaceAroundStep) => {
  if (
    step.from < step.gapFrom &&
    step.to > step.gapTo &&
    step.slice.size === 0 &&
    step.gapTo - step.gapFrom > 0
  ) {
    return true;
  }
  return false;
};

export function isLiftStepForGap(
  gap: {
    start: number;
    end: number;
    slice: Slice;
    insert: number;
  },
  node: PMNode,
  to: number,
) {
  return (
    gap.start < gap.end && gap.insert === 0 && gap.end === to && !node.isText
  );
}

export const isDirectPendingMoveDeletion = (
  step: ReplaceStep,
  doc: PMNode,
  movingSteps: Map<ReplaceStep, string>,
): boolean => {
  if (step.from === step.to || step.slice.content.size > 0) {
    return false;
  }

  if (movingSteps.has(step)) {
    return false;
  }

  const node = doc.nodeAt(step.from);
  if (!node) {
    return false;
  }

  return ChangeSet.isPendingChange(
    node.attrs.dataTracked as TrackedAttrs[] | undefined,
    CHANGE_OPERATION.move,
  );
};

export const isDeletingPendingMovedNode = (step: ReplaceStep, doc: PMNode) => {
  if (!step.slice || step.from === step.to || step.slice.content.size > 0) {
    return undefined;
  }

  const node = doc.nodeAt(step.from);
  if (!node) {
    return undefined;
  }
  const trackedAttrs = node.attrs.dataTracked as TrackedAttrs[];
  const found = trackedAttrs?.find(
    tracked =>
      tracked.operation === CHANGE_OPERATION.move &&
      tracked.status === CHANGE_STATUS.pending,
  );
  if (found?.moveNodeId) {
    return found.moveNodeId;
  }
  return undefined;
};
