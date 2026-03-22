import { Node as PMNode, Slice } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";

import { TrackChangesAction } from "../actions";
import { createNewInsertAttrs, NewEmptyAttrs } from "../helpers";
import { deleteAndMergeSplitNodes } from "../lib/deleteAndMergeSplitNodes";
import {
  setFragmentAsInserted,
  setFragmentAsWrapChange,
} from "../lib/fragments";
import { ExposedSlice, TrTrackingContext, ChangeStep } from "../types";
import { isLiftStep, isWrapStep } from "./qualifiers";

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
  // @ts-expect-error ProseMirror ReplaceAroundStep typing misses slice fields
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
    slice: ExposedSlice;
  } = step;

  const gap = currentStepDoc.slice(gapFrom, gapTo);

  const newStep = step.invert(currentStepDoc);

  const stepResult = newTr.maybeStep(newStep);
  if (stepResult.failed) {
    console.error(
      `inverting ReplaceAroundStep failed: "${stepResult.failed}"`,
      newStep,
    );
    return [];
  }

  preserveDataTrackedFromPreviousStep(newTr, step, newStep);

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
    let insertedSlice = new Slice(fragment, openStart, openEnd) as ExposedSlice;
    if (gap.size > 0 || tr.getMeta(TrackChangesAction.updateMetaNode)) {
      const sliceContent = gap.content;
      insertedSlice = insertedSlice.insertAt(
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
          slice: new Slice(fragmentTracked, 0, 0) as ExposedSlice,
          sliceWasSplit: true,
        });
      }
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
