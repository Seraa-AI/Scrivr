import { Fragment, Slice } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { Mapping, ReplaceStep } from "prosemirror-transform";

import { ChangeStep, ExposedReplaceStep, ExposedSlice, TrTrackingContext } from "../types";
import { getAction, TrackChangesAction } from "../actions";
import {
  createNewInsertAttrs,
  createNewMoveAttrs,
  NewEmptyAttrs,
} from "../helpers";
import { isSplitStep } from "./qualifiers";
import {
  isStructuralChange,
  joinStructureChanges,
} from "../lib/structuralChange";
import { deleteAndMergeSplitNodes } from "../lib/deleteAndMergeSplitNodes";
import {
  setFragmentAsInserted,
  setFragmentAsMoveChange,
  setFragmentAsNodeSplit,
} from "../lib/fragments";
import { mapChangeSteps } from "../engine/changeStep";

export function trackReplaceStep(
  i: number,
  oldState: EditorState,
  newTr: Transaction,
  attrsTemplate: NewEmptyAttrs,
  tr: Transaction,
  deletedNodeMapping: Mapping,
  trContext: TrTrackingContext,
) {
  const step = tr.steps[i] as ReplaceStep;
  const moveID = trContext.stepsByGroupIDMap.get(step);

  const invertedStep = step.invert(tr.docs[i]!);

  const newStep = new ReplaceStep(
    deletedNodeMapping.map(invertedStep.from),
    deletedNodeMapping.map(invertedStep.to),
    invertedStep.slice,
  );
  const stepResult = newTr.maybeStep(newStep);

  let selectionPos = 0;
  const changeSteps: ChangeStep[] = [];
  if (stepResult.failed) {
    return [changeSteps, undefined] as [ChangeStep[], number | undefined];
  }

  const attrs = { ...attrsTemplate };

  if (moveID) {
    attrs.moveNodeId = moveID;
  }

  step
    .getMap()
    .forEach((fromA: number, toA: number, fromB: number, _toB: number) => {
      const { slice } = step as ExposedReplaceStep;
      const {
        sliceWasSplit,
        newSliceContent,
        steps: deleteSteps,
      } = deleteAndMergeSplitNodes(
        fromA,
        toA,
        undefined,
        tr.docs[i]!,
        oldState.schema,
        attrs,
        slice,
      );
      changeSteps.push(...deleteSteps);
      const backSpacedText = sameThingBackSpaced(changeSteps, newSliceContent);

      if (backSpacedText) {
        changeSteps.splice(changeSteps.indexOf(backSpacedText));
      }

      if (!backSpacedText && newSliceContent.size > 0) {
        let fragment = setFragmentAsInserted(
          newSliceContent,
          createNewInsertAttrs(attrs),
          oldState.schema,
        );

        if (isStructuralChange(tr)) {
          fragment = joinStructureChanges(
            attrs,
            newSliceContent,
            fragment,
            tr,
            newTr,
          );
        } else if (
          isSplitStep(step, oldState.selection, tr.getMeta("uiEvent"))
        ) {
          fragment = setFragmentAsNodeSplit(
            newTr.doc.resolve(step.from),
            newTr,
            fragment,
            attrs,
          );
        } else if (moveID) {
          const indentationType = getAction(
            tr,
            TrackChangesAction.indentationAction,
          )?.action as "indent" | "unindent" | undefined;

          fragment = setFragmentAsMoveChange(
            newSliceContent,
            createNewMoveAttrs(attrs, indentationType),
          );
        }
        const openStart =
          slice.openStart !== slice.openEnd ? 0 : slice.openStart;
        const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd;
        const textWasDeleted = !!changeSteps.length && !(fromA === fromB);
        const isBlock = !!fragment.firstChild?.isBlock;

        changeSteps.push({
          type: "insert-slice",
          from: textWasDeleted ? fromB : isBlock ? toA : fromA,
          to: textWasDeleted ? fromB : isBlock ? toA : fromA,
          sliceWasSplit,
          slice: new Slice(fragment, openStart, openEnd) as ExposedSlice,
        });
      } else {
        const winEvent = typeof window !== "undefined" ? window.event as (KeyboardEvent & { inputType?: string }) | undefined : undefined;
        const isDeleteEvent = winEvent?.code === "Delete";
        const isDeleteContentForward = winEvent?.inputType === "deleteContentForward";
        selectionPos = isDeleteEvent || isDeleteContentForward ? toA : fromA;
      }
    });

  selectionPos = deletedNodeMapping.map(selectionPos);
  const doneSteps = mapChangeSteps(changeSteps, deletedNodeMapping);

  return [doneSteps, selectionPos] as [ChangeStep[], number];
}

function sameThingBackSpaced(
  changeSteps: ChangeStep[],
  newSliceContent: Fragment,
) {
  if (changeSteps.length == 2 && newSliceContent.size > 0) {
    const correspondingDeletion = changeSteps.find(
      step =>
        step.type === "delete-text" &&
        step.node.text === newSliceContent.content[0]!.text,
    );
    return correspondingDeletion;
  }
  return undefined;
}
