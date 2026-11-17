import { Mark, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  type Step,
} from "@scrivr/core/pm";

import {
  createNewDeleteAttrs,
  createNewInsertAttrs,
  excludes,
  genId,
  isValidTrackableMark,
  markRecords,
  marksToRestore,
  NewEmptyAttrs,
  restoredKey,
  restoredOnReject,
  restoresItself,
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
  const pending = sameMark;
  const stepsOver = (from: number, to: number): Step[] => {
    if (pending && markHasOp(pending, CHANGE_OPERATION.insert)) {
      // Removing a pending insert cancels it; what it replaced was agreed, so its removal is proposed instead.
      const agreed = markRecords(pending).flatMap(record => marksToRestore(record, pending.type.schema));
      return [
        new RemoveMarkStep(from, to, pending),
        ...agreed.map(mark => new AddMarkStep(from, to, mark.type.create({
          ...mark.attrs,
          dataTracked: [{ ...createNewDeleteAttrs(emptyAttrs), id: genId() }],
        }))),
      ];
    }
    if (pending && markHasOp(pending, CHANGE_OPERATION.delete)) {
      // Mark was already pending delete — clear the tracking data.
      return [new AddMarkStep(from, to, markSource!.create({ ...existingAttrs, dataTracked: [] }))];
    }
    return [new AddMarkStep(from, to, newMark)];
  };

  try {
    for (const [from, to] of notSuperseded(step.mark, placed.from, placed.to, newTr.doc)) {
      for (const written of stepsOver(from, to)) newTr.step(written);
    }
  } catch (e) {
    console.error("trackRemoveMarkStep failed: " + e);
  }
}

/**
 * The stretches of `from`–`to` where no mark proposed by a later step of the
 * transaction stands over `removed`. There, that mark's record already restores
 * what was removed (a link's address changed by removing the old link and
 * adding the new), and tracking the removal too would push it off.
 */
function notSuperseded(removed: Mark, from: number, to: number, doc: PMNode): [number, number][] {
  const ranges: [number, number][] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    const superseded = node.marks.some(mark =>
      excludes(mark, removed) && markRecords(mark).some(r => r.status === CHANGE_STATUS.pending && r.operation === CHANGE_OPERATION.insert));
    if (superseded) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    const last = ranges[ranges.length - 1];
    if (last && last[1] === start) last[1] = end;
    else ranges.push([start, end]);
  });
  return ranges;
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

/**
 * A mark that excludes others (a colour, a size, a link) replaces them inside
 * its own step, so the step says nothing of what was there. What rejecting it
 * restores is read from the document as the transaction found it — text this
 * transaction wrote has only what it was written with — and kept on its
 * record. It writes only where its own mark still stands in the replayed text:
 * a later step that set the same kind there has the last word. Text whose
 * restore differs is a change of its own; where rejecting would restore the
 * value it sets, there is nothing to propose.
 */
/**
 * The marks the text from `from` to `to` of `tr.docs[index]` had when the
 * transaction found it, piece by piece. Text the transaction wrote has only
 * what `node`, which holds it, carries.
 */
function asFound(
  tr: Transaction,
  index: number,
  node: PMNode,
  from: number,
  to: number,
): { from: number; to: number; marks: readonly Mark[] }[] {
  const start = tr.docs[0];
  // Its own maps, not `slice(0, index)`: `invert()` reads a slice's every map, past its end too.
  const forward = new Mapping(tr.mapping.maps.slice(0, index));
  const back = forward.invert();
  const found = back.mapResult(from, 1);
  const written = [{ from, to, marks: node.marks }];
  if (!start || found.deletedAfter) return written;
  const end = back.map(to, -1);
  const pieces: { from: number; to: number; marks: readonly Mark[] }[] = [];
  start.nodesBetween(found.pos, end, (startNode, at) => {
    if (!startNode.isInline) return;
    const pieceFrom = Math.max(from, forward.map(Math.max(at, found.pos), 1));
    const pieceTo = Math.min(to, forward.map(Math.min(at + startNode.nodeSize, end), -1));
    if (pieceFrom < pieceTo) pieces.push({ from: pieceFrom, to: pieceTo, marks: startNode.marks });
  });
  return pieces.length > 0 ? pieces : written;
}

export function trackAddMarkStep(
  step: AddMarkStep,
  index: number,
  tr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;
  const doc = tr.docs[index];
  if (!doc) return;

  const runs: { from: number; to: number; restored: readonly Mark[]; key: string }[] = [];
  doc.nodesBetween(step.from, step.to, (node, pos, parent) => {
    if (!node.isInline || !parent?.type.allowsMarkType(step.mark.type)) return;
    for (const piece of asFound(tr, index, node, Math.max(pos, step.from), Math.min(pos + node.nodeSize, step.to))) {
      // Text that had this very mark agreed changes nothing; nor does one that would restore it.
      if (step.mark.isInSet(piece.marks)) continue;
      const restored = restoredOnReject(step.mark, piece.marks);
      if (restoresItself(step.mark, restored)) continue;
      const key = restoredKey(restored);
      const from = replayBridge.map(piece.from, 1);
      const to = replayBridge.map(piece.to, -1);
      if (from >= to) continue;
      newTr.doc.nodesBetween(from, to, (replayed, at) => {
        if (!replayed.isInline || !step.mark.isInSet(replayed.marks)) return;
        const runFrom = Math.max(at, from);
        const runTo = Math.min(at + replayed.nodeSize, to);
        const last = runs[runs.length - 1];
        if (last && last.to === runFrom && last.key === key) last.to = runTo;
        else runs.push({ from: runFrom, to: runTo, restored, key });
      });
    }
  });

  try {
    for (const { from, to, restored } of runs) {
      const record = {
        ...createNewInsertAttrs(emptyAttrs),
        id: genId(),
        ...(restored.length > 0 ? { replaced: restored.map(toReplacedMark) } : {}),
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
