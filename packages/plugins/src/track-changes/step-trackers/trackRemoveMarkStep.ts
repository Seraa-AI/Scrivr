import { Mark, Node as PMNode } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import {
  AddMarkStep,
  AddNodeMarkStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from "prosemirror-transform";

import {
  createNewDeleteAttrs,
  createNewInsertAttrs,
  genId,
  isValidTrackableMark,
  NewEmptyAttrs,
} from "../helpers";
import { CHANGE_OPERATION, DataTrackedAttrs } from "../types";

function markHasOp(mark: Mark, operation: CHANGE_OPERATION) {
  if (mark.attrs.dataTracked && Array.isArray(mark.attrs.dataTracked)) {
    const dtAttrs = mark.attrs.dataTracked as DataTrackedAttrs[];
    return dtAttrs.some(at => at.operation === operation);
  }
}

export function trackRemoveMarkStep(
  step: RemoveMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markName = step.mark.type.name;
  const markSource = step.mark.type.schema.marks[markName];
  let sameMark: Mark | null = null;

  // Find the actual mark instance on the text node — it may carry existing
  // tracking data and the original attrs (color, size, family, etc.).
  const targetNode = doc.nodeAt(step.from);
  if (targetNode) {
    let targetNodePos = -1;
    doc.descendants((node, pos) => {
      if (node === targetNode) targetNodePos = pos;
      if (targetNodePos >= 0) return false;
    });
    const found = targetNode.marks.find(m => m.type.name === markName && m.attrs.dataTracked?.length);
    const nodeEnd = targetNodePos + targetNode.nodeSize;
    if (found && step.from <= nodeEnd && step.to <= nodeEnd) sameMark = found;
  }

  // Find the mark's current attrs (preserves color/size/family on removal).
  const existingMark = targetNode?.marks.find(m => m.type.name === markName);
  const existingAttrs = existingMark?.attrs ?? {};

  const newDataTracked = createNewDeleteAttrs(emptyAttrs);
  const newMark = markSource!.create({
    ...existingAttrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  let newStep = new AddMarkStep(step.from, step.to, newMark);

  if (sameMark) {
    if (markHasOp(sameMark, CHANGE_OPERATION.delete)) {
      // Mark was already pending delete — clear the tracking data.
      newStep = new AddMarkStep(step.from, step.to, markSource!.create({ ...existingAttrs, dataTracked: [] }));
    }
    if (markHasOp(sameMark, CHANGE_OPERATION.insert)) {
      // Mark was a pending insert — removing it cancels the insert entirely.
      newStep = new RemoveMarkStep(step.from, step.to, sameMark);
    }
  }

  try {
    newTr.step(newStep);
  } catch (e) {
    console.error("trackRemoveMarkStep failed: " + e);
  }
}

export function trackRemoveNodeMarkStep(
  step: RemoveNodeMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markName = step.mark.type.name;
  const markSource = step.mark.type.schema.marks[markName];
  let sameMark: Mark | null = null;

  const targetNode = doc.nodeAt(step.pos);
  if (targetNode) {
    targetNode.marks.forEach(mark => {
      if (mark.type.name === markName && mark.attrs.dataTracked?.length) sameMark = mark;
    });
  }

  const existingAttrs = (sameMark as Mark | null)?.attrs ?? targetNode?.marks.find(m => m.type.name === markName)?.attrs ?? {};
  const newDataTracked = createNewDeleteAttrs(emptyAttrs);
  const newMark = markSource!.create({
    ...existingAttrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  let newStep = new AddNodeMarkStep(step.pos, newMark);

  if (sameMark) {
    if (markHasOp(sameMark, CHANGE_OPERATION.delete)) {
      newStep = new AddNodeMarkStep(step.pos, markSource!.create({ ...existingAttrs, dataTracked: [] }));
    }
    if (markHasOp(sameMark, CHANGE_OPERATION.insert)) {
      newStep = new AddNodeMarkStep(step.pos, sameMark);
    }
  }

  try {
    const inverted = step.invert(doc);
    newTr.step(inverted);
    newTr.step(newStep);
  } catch (e) {
    console.error("trackRemoveNodeMarkStep failed: " + e);
  }
}

export function trackAddMarkStep(
  step: AddMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  _doc: PMNode,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markName = step.mark.type.name;
  const markSource = step.mark.type.schema.marks[markName];

  const newDataTracked = createNewInsertAttrs(emptyAttrs);
  // Preserve the original mark's attrs (e.g. color value, font size) so the
  // tracked version looks and behaves identically to the original.
  const newMark = markSource!.create({
    ...step.mark.attrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  const newStep = new AddMarkStep(step.from, step.to, newMark);
  try {
    const inverted = step.invert();
    newTr.step(inverted);
    newTr.step(newStep);
  } catch (e) {
    console.error("trackAddMarkStep failed: " + e);
  }
}

export function trackAddNodeMarkStep(
  step: AddNodeMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  stepDoc: PMNode,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markSource = step.mark.type.schema.marks[step.mark.type.name];
  const newDataTracked = createNewInsertAttrs(emptyAttrs);
  const newMark = markSource!.create({
    ...step.mark.attrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  const newStep = new AddNodeMarkStep(step.pos, newMark);
  try {
    const inverted = step.invert(stepDoc);
    newTr.step(inverted);
    newTr.step(newStep);
  } catch (e) {
    console.error("trackAddNodeMarkStep failed: " + e);
  }
}
