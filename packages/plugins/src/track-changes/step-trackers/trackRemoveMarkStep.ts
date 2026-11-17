import { Mark, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  type Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from "@scrivr/core/pm";

import {
  createNewDeleteAttrs,
  createNewInsertAttrs,
  genId,
  isValidTrackableMark,
  markRecords,
  NewEmptyAttrs,
  replacedMarks,
  toReplacedMark,
} from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, DataTrackedAttrs } from "../types";

function markHasOp(mark: Mark, operation: CHANGE_OPERATION) {
  if (mark.attrs.dataTracked && Array.isArray(mark.attrs.dataTracked)) {
    const dtAttrs: DataTrackedAttrs[] = mark.attrs.dataTracked;
    return dtAttrs.some(at => at.operation === operation);
  }
}

/**
 * `step` says what was removed, so it is read in the document it applied to;
 * `placed` is the same step in the replayed document, which is where it writes.
 */
export function trackRemoveMarkStep(
  step: RemoveMarkStep,
  placed: RemoveMarkStep,
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
  let newStep = new AddMarkStep(placed.from, placed.to, newMark);

  if (sameMark) {
    if (markHasOp(sameMark, CHANGE_OPERATION.delete)) {
      // Mark was already pending delete — clear the tracking data.
      newStep = new AddMarkStep(placed.from, placed.to, markSource!.create({ ...existingAttrs, dataTracked: [] }));
    }
    if (markHasOp(sameMark, CHANGE_OPERATION.insert)) {
      // Mark was a pending insert — removing it cancels the insert entirely.
      newStep = new RemoveMarkStep(placed.from, placed.to, sameMark);
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
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markName = step.mark.type.name;
  const markSource = step.mark.type.schema.marks[markName];
  let sameMark: Mark | null = null;

  const targetNode = doc.nodeAt(step.pos);
  if (targetNode) {
    for (const mark of targetNode.marks) {
      if (mark.type.name === markName && mark.attrs.dataTracked?.length) sameMark = mark;
    }
  }

  const existingAttrs = sameMark?.attrs ?? targetNode?.marks.find(m => m.type.name === markName)?.attrs ?? {};
  const newDataTracked = createNewDeleteAttrs(emptyAttrs);
  const newMark = markSource!.create({
    ...existingAttrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  const pos = replayBridge.map(step.pos, 1);
  let newStep = new AddNodeMarkStep(pos, newMark);

  if (sameMark) {
    if (markHasOp(sameMark, CHANGE_OPERATION.delete)) {
      newStep = new AddNodeMarkStep(pos, markSource!.create({ ...existingAttrs, dataTracked: [] }));
    }
    if (markHasOp(sameMark, CHANGE_OPERATION.insert)) {
      newStep = new AddNodeMarkStep(pos, sameMark);
    }
  }

  try {
    const inverted = step.invert(doc).map(replayBridge);
    if (!inverted) return;
    newTr.step(inverted);
    newTr.step(newStep);
  } catch (e) {
    console.error("trackRemoveNodeMarkStep failed: " + e);
  }
}

const untracked = (mark: Mark) =>
  isValidTrackableMark(mark) ? mark.type.create({ ...mark.attrs, dataTracked: [] }) : mark;

/**
 * What rejecting `mark` must put back on a node that carries `marks`: the
 * settled formatting it pushes off. A pushed-off suggestion was never agreed,
 * so it is superseded and gives back what it replaced in turn; anything else
 * returns without its tracking, unless it is the value `mark` sets anyway.
 */
function pushedOff(mark: Mark, marks: readonly Mark[]): Mark[] {
  const kept = mark.addToSet(marks);
  return marks
    .filter(m => !m.eq(mark) && !m.isInSet(kept))
    .flatMap(m => {
      const suggested = markRecords(m).filter(r => r.status === CHANGE_STATUS.pending && r.operation === CHANGE_OPERATION.insert);
      if (suggested.length > 0) return suggested.flatMap(r => replacedMarks(r, m.type.schema));
      const settled = untracked(m);
      return settled.eq(untracked(mark)) ? [] : [settled];
    });
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) =>
  a.length === b.length && a.every(m => b.some(o => o.eq(m)));

/**
 * `step` is read in `doc`, the document it applied to; it is written in the
 * replayed document through `replayBridge`. A mark that excludes others (a
 * colour, a size) replaces them inside its own step, so what it pushed off is
 * read from `doc` — and from the replayed text, where a removal tracked earlier
 * in the same transaction stands — and kept on its record for rejection to
 * restore. Text that lost different marks is a change of its own.
 */
export function trackAddMarkStep(
  step: AddMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode,
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const runs: { from: number; to: number; replaced: Mark[] }[] = [];
  doc.nodesBetween(step.from, step.to, (node, pos, parent) => {
    if (!node.isInline || !parent?.type.allowsMarkType(step.mark.type)) return;
    const from = replayBridge.map(Math.max(pos, step.from), 1);
    const to = replayBridge.map(Math.min(pos + node.nodeSize, step.to), -1);
    if (from >= to) return;
    const replaced = [...pushedOff(step.mark, node.marks), ...pushedOff(step.mark, newTr.doc.nodeAt(from)?.marks ?? [])]
      .filter((mark, i, all) => all.findIndex(other => other.eq(mark)) === i);
    const last = runs[runs.length - 1];
    if (last && last.to === from && sameMarks(last.replaced, replaced)) last.to = to;
    else runs.push({ from, to, replaced });
  });

  const ids: { replaced: Mark[]; id: string }[] = [];
  const idFor = (replaced: Mark[]) => {
    const known = ids.find(entry => sameMarks(entry.replaced, replaced));
    if (known) return known.id;
    const id = genId();
    ids.push({ replaced, id });
    return id;
  };

  try {
    for (const { from, to, replaced } of runs) {
      const record = {
        ...createNewInsertAttrs(emptyAttrs),
        id: idFor(replaced),
        ...(replaced.length > 0 ? { replaced: replaced.map(toReplacedMark) } : {}),
      };
      // Not `step.invert(doc)`: `doc` is in the source frame, these positions in the replayed one.
      newTr.step(new RemoveMarkStep(from, to, step.mark));
      // The mark keeps its own attrs (a colour, a size), so the tracked one looks as the plain one did.
      newTr.step(new AddMarkStep(from, to, step.mark.type.create({ ...step.mark.attrs, dataTracked: [record] })));
    }
  } catch (e) {
    console.error("trackAddMarkStep failed: " + e);
  }
}

export function trackAddNodeMarkStep(
  step: AddNodeMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  stepDoc: PMNode,
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const markSource = step.mark.type.schema.marks[step.mark.type.name];
  const newDataTracked = createNewInsertAttrs(emptyAttrs);
  const newMark = markSource!.create({
    ...step.mark.attrs,
    dataTracked: [{ ...newDataTracked, id: genId() }],
  });
  const newStep = new AddNodeMarkStep(replayBridge.map(step.pos, 1), newMark);
  try {
    const inverted = step.invert(stepDoc).map(replayBridge);
    if (!inverted) return;
    newTr.step(inverted);
    newTr.step(newStep);
  } catch (e) {
    console.error("trackAddNodeMarkStep failed: " + e);
  }
}
