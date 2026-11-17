/**
 * What a formatting suggestion holds when it is recorded, and what deciding it
 * leaves. A colour, a size, a font or a link excludes its own kind, so setting
 * one replaces another inside a single step: the record keeps what it replaced
 * — agreed formatting untracked, another author's suggestion whole — and
 * `settle` turns decisions back into marks.
 */
import { isTrackedMark, stableStringify } from "@scrivr/core";
import { AddMarkStep, Mark, RemoveMarkStep, type Schema, type Step } from "@scrivr/core/pm";

import { createNewDeleteAttrs, genId, isValidTrackableMark, markRecords, type NewEmptyAttrs } from "./helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, type ReplacedMark, type TrackedAttrs } from "./types";

/** A record's decision in a review, by id; `undefined` while it is left undecided. */
export type DecisionOf = (id: string) => CHANGE_STATUS.accepted | CHANGE_STATUS.rejected | undefined;

/** A mark as a record keeps it: its type and attrs, and its records only when it has any. */
export const toReplacedMark = (mark: Mark): ReplacedMark => {
  const { dataTracked: _tracking, ...attrs } = mark.attrs;
  const records = markRecords(mark);
  return { type: mark.type.name, attrs: records.length > 0 ? { ...attrs, dataTracked: records } : attrs };
};

/** `mark` carrying exactly `records`; a mark that cannot carry records is returned as it is. */
const withRecords = (mark: Mark, records: readonly Partial<TrackedAttrs>[]): Mark =>
  isValidTrackableMark(mark) ? mark.type.create({ ...mark.attrs, dataTracked: [...records] }) : mark;

/**
 * The marks a record says to put back, as `schema` makes them: agreed
 * formatting, or another author's suggestion the change holds, with its
 * records. Records arrive from saved and synced documents, so an entry the
 * schema cannot make — an unknown or review type, attrs it refuses — is left
 * out, and a record that does not read as one is dropped, never trusted.
 */
export function marksToRestore(record: Partial<TrackedAttrs>, schema: Schema): Mark[] {
  const replaced: unknown = record.replaced;
  if (!Array.isArray(replaced)) return [];
  return replaced.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("type" in entry) || !("attrs" in entry)) return [];
    const { type, attrs } = entry;
    const markType = typeof type === "string" && !isTrackedMark(type) ? schema.marks[type] : undefined;
    if (!markType || typeof attrs !== "object" || attrs === null) {
      console.warn("track-changes: a replaced mark this schema cannot restore was left out", entry);
      return [];
    }
    try {
      const made = markType.create(attrs);
      return [withRecords(made, markRecords(made))];
    } catch (e) {
      console.warn("track-changes: a replaced mark this schema refuses was left out", entry, e);
      return [];
    }
  });
}

/** A mark as agreed text carries it: without the records that track it. */
export const untracked = (mark: Mark): Mark => withRecords(mark, []);

/** Whether setting `mark` takes `other` off the text, as a colour does another colour. */
export const excludes = (mark: Mark, other: Mark): boolean => !other.eq(mark) && !other.isInSet(mark.addToSet([other]));

export const pendingRecords = (mark: Mark) => markRecords(mark).filter(r => r.status === CHANGE_STATUS.pending);

/** Whether `mark` carries pending work by someone other than `authorID`: then it stays theirs, held whole. */
const othersWork = (mark: Mark, authorID: string) => pendingRecords(mark).some(r => r.authorID !== authorID);

/**
 * What rejecting `mark`, set by `authorID` over text carrying `marks`, must
 * put back, as one ordered set. Another author's pending work is held whole,
 * records and all, so it is decided by someone rather than lost. The author's
 * own suggestion folds into this change, giving back what it replaced; agreed
 * formatting comes back untracked.
 */
export function restoredOnReject(mark: Mark, marks: readonly Mark[], authorID: string): readonly Mark[] {
  return Mark.setFrom(
    marks
      .filter(other => excludes(mark, other))
      .flatMap(other => {
        if (othersWork(other, authorID)) return [other];
        return isSuggested(other) ? markRecords(other).flatMap(r => marksToRestore(r, other.type.schema)) : [untracked(other)];
      }),
  );
}

/** Whether rejecting `mark` would leave what setting it leaves: then there is nothing to propose. */
export const restoresItself = (mark: Mark, restored: readonly Mark[]): boolean =>
  restored.length === 1 && !!restored[0]?.eq(untracked(mark));

const restoredKey = (restored: readonly Mark[]): string => stableStringify(restored.map(toReplacedMark));

const isSuggested = (mark: Mark) =>
  markRecords(mark).some(r => r.status === CHANGE_STATUS.pending && r.operation === CHANGE_OPERATION.insert);

/**
 * The steps that propose taking `mark` off `from`–`to`. Another author's
 * pending work stays theirs: the removal is one more record on their mark. The
 * author's own suggestion is withdrawn, and removing what it replaced is
 * proposed in its place; their own pending removal stays agreed; anything else
 * is struck.
 */
export function proposeRemoval(mark: Mark, from: number, to: number, emptyAttrs: NewEmptyAttrs): Step[] {
  const deletion = () => ({ ...createNewDeleteAttrs(emptyAttrs), id: genId() });
  const strike = (target: Mark) =>
    othersWork(target, emptyAttrs.authorID)
      ? new AddMarkStep(from, to, withRecords(target, [...markRecords(target), deletion()]))
      : new AddMarkStep(from, to, withRecords(target, [deletion()]));
  if (othersWork(mark, emptyAttrs.authorID)) return [new RemoveMarkStep(from, to, mark), strike(mark)];
  if (isSuggested(mark)) {
    return [new RemoveMarkStep(from, to, mark), ...markRecords(mark).flatMap(r => marksToRestore(r, mark.type.schema)).map(strike)];
  }
  if (markRecords(mark).some(r => r.status === CHANGE_STATUS.pending && r.operation === CHANGE_OPERATION.delete)) {
    return [new AddMarkStep(from, to, untracked(mark))];
  }
  return [strike(untracked(mark))];
}

/**
 * The marks text carrying `mark` keeps once `decided` is applied. A mark is
 * settled once from every decision on it, in no order; what an undecided
 * suggestion holds is settled in place, so a held suggestion decided alone
 * changes what its holder would restore.
 */
export function settle(mark: Mark, decided: DecisionOf): Mark[] {
  const records = markRecords(mark);
  const decisionOf = (record: Partial<TrackedAttrs>) => (record.id === undefined ? undefined : decided(record.id));
  if (records.some(r => r.operation === CHANGE_OPERATION.delete && decisionOf(r) === CHANGE_STATUS.accepted)) return [];
  const undecided = records
    .filter(r => decisionOf(r) === undefined)
    .map(r => (r.replaced === undefined ? r : {
      ...r,
      replaced: marksToRestore(r, mark.type.schema).flatMap(held => settle(held, decided)).map(toReplacedMark),
    }));
  const rejected = records.filter(r => r.operation === CHANGE_OPERATION.insert && decisionOf(r) === CHANGE_STATUS.rejected);
  if (rejected.length === 0) return [withRecords(mark, undecided)];
  return rejected
    .flatMap(r => marksToRestore(r, mark.type.schema))
    .flatMap(restored => settle(withRecords(restored, [...markRecords(restored), ...undecided]), decided));
}

/** Whether any record on `mark`, or held by one, is decided. */
export function hasDecision(mark: Mark, decided: DecisionOf): boolean {
  return markRecords(mark).some(r =>
    (r.id !== undefined && decided(r.id) !== undefined) ||
    marksToRestore(r, mark.type.schema).some(held => hasDecision(held, decided)));
}

/** Text from `from` to `to` and the marks it had before the edit being recorded. */
export type FoundPiece = { from: number; to: number; marks: readonly Mark[] };

/**
 * A stretch where setting `mark` is written: proposed, with what rejecting it
 * restores, or — where the text already showed that value under someone's
 * records — given back the mark it `carried`, records and authors intact.
 */
export type RestoreRun = { from: number; to: number; restored: readonly Mark[]; carried?: Mark };

/**
 * The stretches of `pieces` where setting `mark` is written, neighbours alike
 * joined. Text that had `mark` itself, or whose restore is `mark`, has nothing
 * to propose; text that showed its value with records keeps them, since
 * setting what is already shown changes nothing, and takes no one's
 * suggestion from them.
 */
export function restoreRuns(mark: Mark, pieces: Iterable<FoundPiece>, authorID: string): RestoreRun[] {
  const runs: (RestoreRun & { key: string })[] = [];
  const push = (piece: FoundPiece, run: Omit<RestoreRun, "from" | "to">, key: string) => {
    const last = runs[runs.length - 1];
    if (last && last.to === piece.from && last.key === key) last.to = piece.to;
    else runs.push({ from: piece.from, to: piece.to, ...run, key });
  };
  for (const piece of pieces) {
    if (mark.isInSet(piece.marks)) continue;
    const carried = piece.marks.find(other => !other.eq(mark) && untracked(other).eq(untracked(mark)));
    if (carried) {
      push(piece, { restored: [], carried }, `carried:${stableStringify(carried.toJSON())}`);
      continue;
    }
    const restored = restoredOnReject(mark, piece.marks, authorID);
    if (restoresItself(mark, restored)) continue;
    push(piece, { restored }, restoredKey(restored));
  }
  return runs.map(({ key: _key, ...run }) => run);
}
