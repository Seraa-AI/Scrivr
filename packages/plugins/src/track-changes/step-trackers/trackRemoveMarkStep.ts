import { Mark, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import {
  AddMarkStep,
  AddNodeMarkStep,
  Mapping,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from "@scrivr/core/pm";

import {
  createNewDeleteAttrs,
  createNewInsertAttrs,
  excludes,
  genId,
  isValidTrackableMark,
  NewEmptyAttrs,
  proposeRemoval,
  restoredOnReject,
  restoreRuns,
  toReplacedMark,
  type FoundPiece,
  type RestoreRun,
} from "../helpers";
import { CHANGE_OPERATION, DataTrackedAttrs } from "../types";

function markHasOp(mark: Mark, operation: CHANGE_OPERATION) {
  if (mark.attrs.dataTracked && Array.isArray(mark.attrs.dataTracked)) {
    const dtAttrs: DataTrackedAttrs[] = mark.attrs.dataTracked;
    return dtAttrs.some(at => at.operation === operation);
  }
}

/**
 * `step` says what was removed, so it is read in the document it applied to,
 * and written in the replayed one through `replayBridge`. Where the transaction
 * itself had set the removed mark, the removal undoes its own work: what is
 * proposed is removing what the text had before.
 */
export function trackRemoveMarkStep(
  step: RemoveMarkStep,
  index: number,
  tr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;
  try {
    for (const piece of stepPieces(step, index, tr)) {
      // Where the transaction had set the mark itself, what is taken off is what the text had.
      const removing = step.mark.isInSet(piece.marks) ? [step.mark] : restoredOnReject(step.mark, piece.marks);
      for (const [from, to] of notSuperseded(step.mark, replayBridge.map(piece.from, 1), replayBridge.map(piece.to, -1), newTr.doc)) {
        for (const mark of removing) {
          for (const written of proposeRemoval(mark, from, to, emptyAttrs)) newTr.step(written);
        }
      }
    }
  } catch (e) {
    console.error("trackRemoveMarkStep failed: " + e);
  }
}

/**
 * The stretches of `from`–`to` where no mark set by a later step of the
 * transaction stands over `removed` — one of its kind, which only a later step
 * can have put where this one took it off. There the later step answers for
 * what was removed (a link's address changed, or saved unchanged, by removing
 * the link and adding one), and tracking the removal too would undo it.
 */
function notSuperseded(removed: Mark, from: number, to: number, doc: PMNode): [number, number][] {
  const ranges: [number, number][] = [];
  if (from >= to) return ranges;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    if (node.marks.some(mark => mark.eq(removed) || excludes(mark, removed))) return;
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
 * The marks the text from `from` to `to` of `tr.docs[index]` had when the
 * transaction found it, piece by piece. Text the transaction wrote maps to no
 * found text; it has what it was written with, `written`.
 */
function asFound(tr: Transaction, index: number, from: number, to: number, written: readonly Mark[]): FoundPiece[] {
  const start = tr.docs[0];
  if (!start) return [{ from, to, marks: written }];
  // Its own maps, not `slice(0, index)`: `invert()` reads a slice's every map, past its end too.
  const forward = new Mapping(tr.mapping.maps.slice(0, index));
  const back = forward.invert();
  const found: FoundPiece[] = [];
  start.nodesBetween(back.map(from, 1), back.map(to, -1), (node, at) => {
    if (!node.isInline) return;
    const pieceFrom = Math.max(from, forward.map(at, 1));
    const pieceTo = Math.min(to, forward.map(at + node.nodeSize, -1));
    if (pieceFrom < pieceTo) found.push({ from: pieceFrom, to: pieceTo, marks: node.marks });
  });
  const gaps = [from, ...found.flatMap(piece => [piece.from, piece.to]), to];
  const writtenPieces: FoundPiece[] = [];
  for (let i = 0; i < gaps.length; i += 2) {
    const gapFrom = gaps[i]!;
    const gapTo = gaps[i + 1]!;
    if (gapFrom < gapTo) writtenPieces.push({ from: gapFrom, to: gapTo, marks: written });
  }
  return [...found, ...writtenPieces].sort((a, b) => a.from - b.from);
}

/** The inline pieces of `doc` that `step` covers, as the transaction found them. */
function stepPieces(step: AddMarkStep | RemoveMarkStep, index: number, tr: Transaction): FoundPiece[] {
  const pieces: FoundPiece[] = [];
  tr.docs[index]?.nodesBetween(step.from, step.to, (node, pos, parent) => {
    if (!node.isInline || !parent?.type.allowsMarkType(step.mark.type)) return;
    pieces.push(...asFound(tr, index, Math.max(pos, step.from), Math.min(pos + node.nodeSize, step.to), node.marks));
  });
  return pieces;
}

/**
 * A mark that excludes others (a colour, a size, a link) replaces them inside
 * its own step, so the step says nothing of what was there. What rejecting it
 * restores is read from the document as the transaction found it and kept on
 * its record. It writes only where its own mark still stands in the replayed
 * text: a later step that set the same kind there has the last word.
 */
export function trackAddMarkStep(
  step: AddMarkStep,
  index: number,
  tr: Transaction,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  replayBridge: Mapping,
) {
  if (!isValidTrackableMark(step.mark)) return;

  const runs: RestoreRun[] = [];
  for (const run of restoreRuns(step.mark, stepPieces(step, index, tr))) {
    const from = replayBridge.map(run.from, 1);
    const to = replayBridge.map(run.to, -1);
    if (from >= to) continue;
    newTr.doc.nodesBetween(from, to, (replayed, at) => {
      if (!replayed.isInline || !step.mark.isInSet(replayed.marks)) return;
      const runFrom = Math.max(at, from);
      const runTo = Math.min(at + replayed.nodeSize, to);
      const last = runs[runs.length - 1];
      if (last && last.to === runFrom && last.restored === run.restored) last.to = runTo;
      else runs.push({ from: runFrom, to: runTo, restored: run.restored });
    });
  }

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
