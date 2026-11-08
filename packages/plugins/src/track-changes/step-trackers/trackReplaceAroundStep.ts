import { Fragment, Node as PMNode, Slice } from "@scrivr/core/pm";
import type { EditorState, Transaction } from "@scrivr/core/pm";
import { ReplaceAroundStep, ReplaceStep } from "@scrivr/core/pm";

import { TrackChangesAction } from "../actions";
import { advanceBridge } from "../engine/replayBridge";
import { createNewInsertAttrs, NewEmptyAttrs } from "../helpers";
import { deleteAndMergeSplitNodes } from "../lib/deleteAndMergeSplitNodes";
import {
  setFragmentAsInserted,
  setFragmentAsWrapChange,
} from "../lib/fragments";
import { TrTrackingContext, ChangeStep } from "../types";
import { isLiftStep, isWrapStep } from "./qualifiers";

/** The child of `content` that `pos` falls in, or the child boundary it sits on. */
function childAt(content: Fragment, pos: number): { index: number; offset: number } {
  let offset = 0;
  for (let index = 0; index < content.childCount; index++) {
    const end = offset + content.child(index).nodeSize;
    if (end === pos) return { index: index + 1, offset: end };
    if (end > pos) return { index, offset };
    offset = end;
  }
  if (pos === offset) return { index: content.childCount, offset };
  throw new RangeError(`Position ${pos} outside of fragment`);
}

function insertIntoFragment(content: Fragment, dist: number, insert: Fragment, parent?: PMNode): Fragment | null {
  const { index, offset } = childAt(content, dist);
  const child = content.maybeChild(index);
  if (offset === dist || !child || child.isText) {
    if (parent && !parent.canReplace(index, index, insert)) return null;
    return content.cut(0, dist).append(insert).append(content.cut(dist));
  }
  const inner = insertIntoFragment(child.content, dist - offset - 1, insert, child);
  return inner && content.replaceChild(index, child.copy(inner));
}

/**
 * Inserts `insert` at `pos` inside `slice`, keeping its open sides. ProseMirror's
 * own `Slice.insertAt` is internal and untyped, so it is written out here.
 */
function insertIntoSlice(slice: Slice, pos: number, insert: Fragment): Slice {
  const content = insertIntoFragment(slice.content, pos + slice.openStart, insert);
  if (!content) throw new RangeError(`Cannot insert the gap content at ${pos}`);
  return new Slice(content, slice.openStart, slice.openEnd);
}

function preserveDataTrackedFromPreviousStep(
  newTr: Transaction,
  step: ReplaceAroundStep,
  newStep: ReplaceAroundStep,
) {
  const prevDoc = newTr.docs[newTr.docs.length - 2];
  if (prevDoc && (step.slice.openEnd || step.slice.openStart)) {
    prevDoc.nodesBetween(newStep.from, newStep.to, (node, _pos) => {
      newStep.slice.content.forEach((n, offset) => {
        if (
          n.type === node.type &&
          !node.isText &&
          n.attrs.id === node.attrs.id
        ) {
          newTr.setNodeAttribute(
            newStep.from + offset,
            "dataTracked",
            node.attrs.dataTracked,
          );
        }
      });
    });
  }
  return newTr;
}

export function trackReplaceAroundStep(
  step: ReplaceAroundStep,
  oldState: EditorState,
  tr: Transaction,
  newTr: Transaction,
  attrs: NewEmptyAttrs,
  currentStepDoc: PMNode,
  trContext: TrTrackingContext,
) {
  const previousBridge = trContext.replayBridge;
  const replayStart = newTr.mapping.maps.length;
  const newStep = step.invert(currentStepDoc).map(previousBridge);
  if (!(newStep instanceof ReplaceAroundStep)) return [];

  const {
    gapFrom: sourceGapFrom,
    gapTo: sourceGapTo,
  }: { gapFrom: number; gapTo: number } = step;
  const gap = currentStepDoc.slice(sourceGapFrom, sourceGapTo);

  const stepResult = newTr.maybeStep(newStep);
  if (stepResult.failed) {
    console.error(
      `inverting ReplaceAroundStep failed: "${stepResult.failed}"`,
      newStep,
    );
    return [];
  }

  preserveDataTrackedFromPreviousStep(newTr, step, newStep);

  // What this step did, in the replayed document as it stands with the step undone.
  const placed = step.map(advanceBridge(step, previousBridge, newTr, replayStart));
  if (!(placed instanceof ReplaceAroundStep)) return [];
  const {
    from,
    to,
    gapFrom,
    gapTo,
    insert,
    slice,
    structure,
  }: {
    from: number;
    to: number;
    gapFrom: number;
    gapTo: number;
    insert: number;
    structure?: boolean;
    slice: Slice;
  } = placed;

  const {
    sliceWasSplit,
    newSliceContent,
    steps: deleteSteps,
  } = deleteAndMergeSplitNodes(
    from,
    to,
    { start: gapFrom, end: gapTo, slice: gap, insert },
    newTr.doc,
    oldState.schema,
    attrs,
    slice,
  );

  let fragment;
  if (isWrapStep(step)) {
    fragment = setFragmentAsWrapChange(newSliceContent, attrs, oldState.schema);
  } else {
    fragment = setFragmentAsInserted(
      newSliceContent,
      createNewInsertAttrs(attrs),
      oldState.schema,
    );
  }

  const steps: ChangeStep[] = deleteSteps;

  const liftStep = isLiftStep(step);
  if (liftStep) {
    trContext.prevLiftStep = step;
  } else if (
    trContext.prevLiftStep &&
    trContext.prevLiftStep.gapFrom === step.gapTo
  ) {
    trContext.prevLiftStep = step;
  } else {
    delete trContext.prevLiftStep;
  }

  if (
    gap.size > 0 ||
    (!structure && newSliceContent.size > 0) ||
    tr.getMeta(TrackChangesAction.updateMetaNode)
  ) {
    const openStart =
      slice.openStart !== slice.openEnd || newSliceContent.size === 0
        ? 0
        : slice.openStart;
    const openEnd =
      slice.openStart !== slice.openEnd || newSliceContent.size === 0
        ? 0
        : slice.openEnd;
    let insertedSlice = new Slice(fragment, openStart, openEnd);
    if (gap.size > 0 || tr.getMeta(TrackChangesAction.updateMetaNode)) {
      const sliceContent = gap.content;
      insertedSlice = insertIntoSlice(
        insertedSlice,
        insertedSlice.size === 0 ? 0 : insert,
        sliceContent,
      );
    }

    if (trContext.prevLiftStep) {
      trContext.liftFragment = trContext.liftFragment
        ? insertedSlice.content.append(trContext.liftFragment)
        : insertedSlice.content;

      if (tr.steps.indexOf(step) === 0) {
        const fragmentTracked = setFragmentAsInserted(
          trContext.liftFragment,
          createNewInsertAttrs(attrs),
          oldState.schema,
        );
        steps.push({
          type: "insert-slice",
          from: from,
          to: from,
          slice: new Slice(fragmentTracked, 0, 0),
          sliceWasSplit: true,
        });
      }
    } else if (isWrapStep(step)) {
      // Re-applied as a wrap, so the content it wraps and any position inside it
      // are carried rather than removed and written back.
      newTr.step(new ReplaceAroundStep(from, to, gapFrom, gapTo, new Slice(fragment, 0, 0), insert, structure));
    } else {
      steps.push({
        type: "insert-slice",
        from: gapFrom,
        to: gapTo,
        slice: insertedSlice,
        sliceWasSplit,
      });
    }
  }
  return steps;
}
