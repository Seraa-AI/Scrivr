import { Node as PMNode, Slice } from "@scrivr/core/pm";
import { ReplaceAroundStep, ReplaceStep } from "@scrivr/core/pm";


export const isDeleteStep = (step: ReplaceStep) =>
  step.from !== step.to && step.slice.content.size < step.to - step.from;

/**
 * Does this step break a block in two, as Enter does? Read from where the step
 * lands in the document it applied to: a break at a block's end starts a new,
 * empty block, which is an insertion rather than a split. A list item breaks
 * with its paragraph, so the halves are the same nodes down to a text block,
 * as deep as the slice is open.
 */
export const isSplitStep = (step: ReplaceStep, doc: PMNode, uiEvent: string) => {
  const { from, to, slice } = step;

  // A break leaves exactly two halves; more is content inserted between them.
  if (from !== to || slice.content.childCount !== 2 || slice.openStart !== slice.openEnd) return false;
  // Pasted paragraphs are new content, not the caret's paragraph carried over.
  if (uiEvent === "paste") return false;

  const $at = doc.resolve(from);
  return splitDepthOf(slice.content.firstChild, slice.content.lastChild) === slice.openStart && $at.parentOffset !== $at.parent.content.size;
};

/**
 * How many levels two halves of a break share, from the top: the same node
 * type at each level, down to a text block. Zero when they are not halves.
 */
export function splitDepthOf(firstHalf: PMNode | null, secondHalf: PMNode | null): number {
  let first = firstHalf;
  let second = secondHalf;
  for (let depth = 1; first && second && first.type === second.type; depth++) {
    if (first.inlineContent) return depth;
    // The first half is open at its end, the second at its start.
    first = first.lastChild;
    second = second.firstChild;
  }
  return 0;
}

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
  const structure = "structure" in step && !!step.structure;
  return structure && gapFrom === from + 1 && gapTo === to - 1;
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

