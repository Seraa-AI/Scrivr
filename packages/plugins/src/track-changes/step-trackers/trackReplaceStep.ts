import { Fragment, Slice } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { ReplaceStep } from "@scrivr/core/pm";
import { blockIdOf } from "@scrivr/core";

import { ChangeStep, TrTrackingContext } from "../types";
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
import { cutRanges } from "../lib/cutAndPaste";
import {
  setFragmentAsInserted,
  setFragmentAsMoveChange,
  setFragmentAsNodeSplit,
  withoutTakenIds,
} from "../lib/fragments";
import { mapChangeSteps } from "../engine/changeStep";
import { advanceBridge } from "../engine/replayBridge";

export function trackReplaceStep(
  i: number,
  step: ReplaceStep,
  oldState: EditorState,
  newTr: Transaction,
  attrsTemplate: NewEmptyAttrs,
  tr: Transaction,
  trContext: TrTrackingContext,
): [ChangeStep[], number | undefined] {
  const { replayBridge } = trContext;
  const moveID = trContext.stepsByGroupIDMap.get(step);
  const textMove = trContext.textMoves.get(step) ?? trContext.pastedMove?.id;

  const invertedStep = step.invert(tr.docs[i]!);

  // A pure insertion's undo is a point, and has to stay on the far side of work
  // a later step put there. A real range must not swallow that work.
  const newStep = new ReplaceStep(
    replayBridge.map(invertedStep.from),
    replayBridge.map(invertedStep.to, invertedStep.from === invertedStep.to ? 1 : -1),
    invertedStep.slice,
  );
  // Later work inside this insertion is already in the replay, records and all.
  const slice = trContext.composition.composed.has(step)
    ? newTr.doc.slice(newStep.from, newStep.to)
    : step.slice;
  const replayStart = newTr.mapping.maps.length;
  const stepResult = newTr.maybeStep(newStep);

  let selectionPos: number | undefined;
  const changeSteps: ChangeStep[] = [];
  if (stepResult.failed) {
    return [changeSteps, undefined];
  }

  const attrs = { ...attrsTemplate };

  if (moveID) {
    attrs.moveNodeId = moveID;
  }
  if (textMove) attrs.moveId = textMove;

  step
    .getMap()
    .forEach((fromA: number, toA: number, fromB: number, _toB: number) => {
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
          isSplitStep(step, tr.docs[i]!, tr.getMeta("uiEvent"))
        ) {
          // Pass newSliceContent (not fragment) so that text carried into the
          // new paragraph ("lo" from splitting "hel|lo") is NOT marked as a
          // new trackedInsert. Only the structural node_split/reference marks
          // are added; the carried text stays untracked, matching Google Docs.
          // A list item breaks with its paragraph: the item is the block split.
          const depth = step.slice.openStart;
          const $at = tr.docs[i]?.resolve(step.from);
          const splitBlock = $at?.node($at.depth - depth + 1);
          fragment = setFragmentAsNodeSplit(
            newTr.doc.resolve(step.from),
            depth,
            newTr,
            newSliceContent,
            attrs,
            splitBlock ? blockIdOf(splitBlock) : null,
          );
        } else if (moveID) {
          const indentationType = getAction(
            tr,
            TrackChangesAction.indentationAction,
          )?.action;

          fragment = setFragmentAsMoveChange(
            newSliceContent,
            createNewMoveAttrs(attrs, indentationType),
          );
        }
        // Only moved content keeps the id of the block it came from — its
        // left-behind copy shares it by design. A cut pasted elsewhere is a
        // move too, as Word tracks it, but keeps only an id the cut's own
        // deletion holds: a block the cut left live is still that block.
        // Anything else the step wrote under an id the document already has
        // is a new block.
        if (!moveID && !isStructuralChange(tr)) {
          const movedFrom = trContext.pastedMove ? cutRanges(newTr.doc, trContext.pastedMove.cut) : [];
          fragment = withoutTakenIds(fragment, newTr.doc, movedFrom);
        }
        const openStart =
          slice.openStart !== slice.openEnd ? 0 : slice.openStart;
        const openEnd = slice.openStart !== slice.openEnd ? 0 : slice.openEnd;
        const textWasDeleted = !!changeSteps.length && !(fromA === fromB);
        const isBlock = !!fragment.firstChild?.isBlock;
        // Blocks go after what was deleted, unless that ends inside a block's
        // text: then only the block's opening was replaced, and they go before it.
        const blocksAt = tr.docs[i]!.resolve(toA).parent.inlineContent ? fromA : toA;
        const at = textWasDeleted ? fromB : isBlock ? blocksAt : fromA;
        const caretAt = isBlock && blocksAt !== toA ? { caretAt: toA } : {};

        changeSteps.push({
          type: "insert-slice",
          from: at,
          to: at,
          sliceWasSplit,
          slice: new Slice(fragment, openStart, openEnd),
          ...(fragment.size === slice.size ? { undoMapIndex: replayStart } : {}),
          ...caretAt,
        });
      } else {
        const uiEventMeta: string | undefined = tr.getMeta("uiEvent");
        const isDeleteEvent = uiEventMeta === "Delete";
        const isDeleteContentForward = uiEventMeta === "deleteContentForward";
        selectionPos = isDeleteEvent || isDeleteContentForward ? toA : fromA;
      }
    });

  // Positions above are in the document before this step; advancing the bridge
  // past the undo reaches the replay. A pure insertion's undo moves nothing, so
  // its position stands.
  const restored = step.from === step.to
    ? { map: () => newStep.from }
    : advanceBridge(step, replayBridge, newTr, replayStart);
  if (selectionPos !== undefined) selectionPos = restored.map(selectionPos);
  const doneSteps = mapChangeSteps(changeSteps, restored);

  return [doneSteps, selectionPos];
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
