import {
  NodeSelection as NodeSelectionClass,
  Selection,
  TextSelection,
  Transaction,
} from "@scrivr/core/pm";
import { Mapping, ReplaceStep } from "@scrivr/core/pm";

import { isStructuralChange } from "../lib/structuralChange";
import { TrTrackingContext } from "../types";

export const getSelectionStaticConstructor = (sel: Selection) =>
  Object.getPrototypeOf(sel).constructor;

export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  oldTr: Transaction,
  deletedNodeMapping: Mapping,
  trContext: TrTrackingContext,
) {
  const wasNodeSelection = oldTr.selection instanceof NodeSelectionClass;

  if (
    !wasNodeSelection &&
    !oldTr.selectionSet &&
    trContext.selectionPosFromInsertion
  ) {
    const sel: typeof Selection = getSelectionStaticConstructor(
      oldTr.selection,
    );
    const near: Selection = sel.near(
      newTr.doc.resolve(trContext.selectionPosFromInsertion),
      -1,
    );
    newTr.setSelection(near);
    return newTr;
  }

  if (oldTr.selectionSet && oldTr.selection instanceof TextSelection) {
    let from = oldTr.selection.from;

    if (isStructuralChange(oldTr)) {
      const selectionMapping = new Mapping();
      oldTr.steps.map(step => {
        const isDeleteStep =
          step instanceof ReplaceStep &&
          step.from !== step.to &&
          step.slice.size === 0;
        if (isDeleteStep) {
          selectionMapping.appendMap(step.getMap().invert());
        }
      });
      selectionMapping.appendMapping(deletedNodeMapping);
      from = selectionMapping.map(oldTr.selection.from);
    }

    const newPos = newTr.doc.resolve(from);
    newTr.setSelection(new TextSelection(newPos));
    return newTr;
  }

  if (wasNodeSelection) {
    const mappedPos = newTr.mapping.map(oldTr.selection.from, -1);
    const sel: typeof NodeSelectionClass = getSelectionStaticConstructor(
      oldTr.selection,
    );
    newTr.setSelection(sel.create(newTr.doc, mappedPos));
    return newTr;
  }

  return newTr;
}
