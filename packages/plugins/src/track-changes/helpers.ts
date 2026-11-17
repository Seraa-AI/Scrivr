import { AddMarkStep, Attrs, Fragment, Mark, Node as PMNode, RemoveMarkStep, Schema, type Step, type Transaction } from "@scrivr/core/pm";

import { CHANGE_OPERATION, CHANGE_STATUS, type ReplacedMark, TrackedAttrs } from "./types";

export function genId(): string {
  return crypto.randomUUID();
}

import { isTrackedMark, stableStringify } from "@scrivr/core";
export { isTrackedMark } from "@scrivr/core";

/** A mark as a record keeps it: its type and attrs, and its records only when it has any. */
export const toReplacedMark = (mark: Mark): ReplacedMark => {
  const { dataTracked: _tracking, ...attrs } = mark.attrs;
  const records = markRecords(mark);
  return { type: mark.type.name, attrs: records.length > 0 ? { ...attrs, dataTracked: records } : attrs };
};

/** `mark` carrying exactly `records`; one that carries no records is returned as it is. */
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

const pendingRecords = (mark: Mark) => markRecords(mark).filter(r => r.status === CHANGE_STATUS.pending);

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
 * The marks text carrying `mark` keeps once the decisions `statusOf` gives are
 * applied — the one place a mark's decided records become marks, so a mark is
 * settled once from every decision on it, in no order. An accepted removal
 * takes the value off; a rejected suggestion gives back what it replaced, each
 * settled in turn and carrying the mark's undecided records; accepted
 * suggestions and rejected removals leave the mark without their record. What
 * an undecided suggestion holds is settled in place, so a held suggestion
 * decided alone changes what its holder would restore.
 */
export function settle(mark: Mark, statusOf: (id: string) => CHANGE_STATUS | undefined): Mark[] {
  const records = markRecords(mark);
  const decisionOf = (record: Partial<TrackedAttrs>) => {
    const status = record.id === undefined ? undefined : statusOf(record.id);
    return status === CHANGE_STATUS.pending ? undefined : status;
  };
  if (records.some(r => r.operation === CHANGE_OPERATION.delete && decisionOf(r) === CHANGE_STATUS.accepted)) return [];
  const undecided = records
    .filter(r => decisionOf(r) === undefined)
    .map(r => (r.replaced === undefined ? r : {
      ...r,
      replaced: marksToRestore(r, mark.type.schema).flatMap(held => settle(held, statusOf)).map(toReplacedMark),
    }));
  const rejected = records.filter(r => r.operation === CHANGE_OPERATION.insert && decisionOf(r) === CHANGE_STATUS.rejected);
  if (rejected.length === 0) return [withRecords(mark, undecided)];
  return rejected
    .flatMap(r => marksToRestore(r, mark.type.schema))
    .flatMap(restored => settle(withRecords(restored, [...markRecords(restored), ...undecided]), statusOf));
}

/** Whether any record on `mark`, or held by one, is decided in `statusOf`. */
export function hasDecision(mark: Mark, statusOf: (id: string) => CHANGE_STATUS | undefined): boolean {
  return markRecords(mark).some(r => {
    const status = r.id === undefined ? undefined : statusOf(r.id);
    return (status !== undefined && status !== CHANGE_STATUS.pending) ||
      marksToRestore(r, mark.type.schema).some(held => hasDecision(held, statusOf));
  });
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

export function isValidTrackableMark(mark: Mark) {
  const spec = mark.type.spec;
  const name = mark.type.name;
  if (
    !isTrackedMark(name) &&
    spec.attrs?.dataTracked &&
    typeof spec.attrs?.dataTracked === "object"
  ) {
    return true;
  }
  return false;
}

/** The copy a pending move leaves where the moved content was: its deletion, paired by `moveNodeId`. */
export const isMoveShadow = ({ dataTracked }: { dataTracked: Partial<TrackedAttrs> }) =>
  dataTracked.operation === CHANGE_OPERATION.delete && !!dataTracked.moveNodeId;

export function equalMarks(n1: PMNode, n2: PMNode) {
  return (
    n1.marks.length === n2.marks.length &&
    n1.marks.every(mark => n2.marks.find(m => m.type === mark.type))
  );
}

export type NewEmptyAttrs = Omit<TrackedAttrs, "id" | "operation">;

export type NewInsertAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation:
    | CHANGE_OPERATION.insert
    | CHANGE_OPERATION.wrap_with_node
    | CHANGE_OPERATION.structure;
};

export type NewDeleteAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.delete;
};

export type NewUpdateAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.set_node_attributes;
  oldAttrs: Record<string, any>;
};

export type NewSplitNodeAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.node_split;
};

export type NewJoinAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.node_join;
};

export type NewMoveAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.move;
  indentationType?: "indent" | "unindent";
};

export type NewReferenceAttrs = Omit<TrackedAttrs, "id" | "operation"> & {
  operation: CHANGE_OPERATION.reference;
  referenceId: string;
  originalNodeId?: string;
};

export type NewTrackedAttrs = NewInsertAttrs | NewDeleteAttrs | NewUpdateAttrs | NewMoveAttrs;

export function createNewInsertAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.insert };
}

export function createNewWrapAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.wrap_with_node };
}

export function createNewSplitAttrs(attrs: NewEmptyAttrs): NewSplitNodeAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.node_split };
}

export function createNewJoinAttrs(attrs: NewEmptyAttrs): NewJoinAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.node_join };
}

export function createNewReferenceAttrs(attrs: NewEmptyAttrs, id: string, originalNodeId: string | null): NewReferenceAttrs {
  return {
    ...attrs,
    operation: CHANGE_OPERATION.reference,
    referenceId: id,
    ...(originalNodeId !== null ? { originalNodeId } : {}),
  };
}

export function createNewDeleteAttrs(attrs: NewEmptyAttrs): NewDeleteAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.delete };
}

export function createNewMoveAttrs(
  attrs: NewEmptyAttrs,
  indentationType?: "indent" | "unindent",
): NewMoveAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.move, ...(indentationType && { indentationType }) };
}

export function createNewUpdateAttrs(
  attrs: NewEmptyAttrs,
  oldAttrs: Record<string, any>,
): NewUpdateAttrs {
  const { dataTracked, ...restAttrs } = oldAttrs;
  return {
    ...attrs,
    operation: CHANGE_OPERATION.set_node_attributes,
    oldAttrs: JSON.parse(JSON.stringify(restAttrs)),
  };
}

export function createNewStructureAttrs(attrs: NewEmptyAttrs): NewInsertAttrs {
  return { ...attrs, operation: CHANGE_OPERATION.structure };
}

export function createNewPendingAttrs(time: number, authorID: string): NewEmptyAttrs {
  return {
    authorID,
    reviewedByID: null,
    createdAt: time,
    updatedAt: time,
    statusUpdateAt: 0,
    status: CHANGE_STATUS.pending,
  };
}

export function addTrackIdIfDoesntExist(attrs: Partial<TrackedAttrs>) {
  if (!attrs.id) {
    return { id: genId(), ...attrs };
  }
  return attrs;
}

export function getTextNodeTrackedMarkData(node: PMNode | null, schema: Schema) {
  if (!node || !node.isText) return undefined;

  const marksTrackedData: (Omit<Partial<TrackedAttrs>, "operation"> & {
    operation: CHANGE_OPERATION;
  })[] = [];

  node.marks.forEach(mark => {
    if (mark.type === schema.marks.trackedInsert || mark.type === schema.marks.trackedDelete) {
      const operation =
        mark.type === schema.marks.trackedInsert ? CHANGE_OPERATION.insert : CHANGE_OPERATION.delete;
      marksTrackedData.push({ ...mark.attrs.dataTracked, operation });
    }
  });

  // Return all tracked mark data — a text node can have stacked marks from
  // different authors (trackedInsert + trackedDelete coexisting via excludes:"").
  return marksTrackedData.length > 0 ? marksTrackedData : undefined;
}

export function getBlockInlineTrackedData(node: PMNode): Partial<TrackedAttrs>[] | undefined {
  const { dataTracked } = node.attrs;
  if (dataTracked && !Array.isArray(dataTracked)) return [dataTracked];
  return dataTracked || [];
}

/**
 * Whether the proposed view leaves this node out: an object whose own record
 * proposes deleting it, or text carrying a pending deletion.
 */
export function proposedForDeletion(node: PMNode): boolean {
  const records = [
    ...(getBlockInlineTrackedData(node) ?? []),
    ...node.marks.filter((mark) => mark.type.name === "trackedDelete").flatMap((mark) => [mark.attrs.dataTracked].flat()),
  ];
  return records.some((record) =>
    record?.operation === CHANGE_OPERATION.delete && record.status === CHANGE_STATUS.pending);
}

export function getMarkTrackedData(node: PMNode | undefined | null) {
  const tracked = node?.marks.reduce((acc, current) => {
    if (isValidTrackableMark(current) && current.attrs.dataTracked) {
      acc.set(current, current.attrs.dataTracked);
    }
    return acc;
  }, new Map<Mark, Array<Partial<TrackedAttrs>>>());

  return tracked || new Map<Mark, Array<Partial<TrackedAttrs>>>();
}

export function getNodeTrackedData(
  node: PMNode | undefined | null,
  schema: Schema,
): Partial<TrackedAttrs>[] | undefined {
  let tracked;
  if (node && !node.isText) {
    tracked = getBlockInlineTrackedData(node);
  } else if (node?.isText) {
    tracked = getTextNodeTrackedMarkData(node, schema);
  }
  if (tracked && !Array.isArray(tracked)) tracked = [tracked];
  return tracked;
}

export function shouldMergeTrackedAttributes(
  left?: Partial<TrackedAttrs>,
  right?: Partial<TrackedAttrs>,
) {
  if (!left || !right) {
    console.warn("passed undefined dataTracked attributes to shouldMergeTrackedAttributes", {
      left,
      right,
    });
    return false;
  }
  return (
    left.status === right.status &&
    left.operation === right.operation &&
    left.authorID === right.authorID &&
    left.creationId === right.creationId &&
    left.deletionId === right.deletionId &&
    left.continuesId === right.continuesId &&
    left.moveId === right.moveId &&
    left.foldingClosed === right.foldingClosed &&
    JSON.stringify(left.dependsOn ?? []) === JSON.stringify(right.dependsOn ?? []) &&
    // A record restores what it replaced, so two that replaced different marks stay two.
    stableStringify(left.replaced ?? []) === stableStringify(right.replaced ?? [])
  );
}

export function getMergeableMarkTrackedAttrs(
  node: PMNode | null,
  attrs: Partial<TrackedAttrs>,
  schema: Schema,
) {
  const allAttrs = getTextNodeTrackedMarkData(node, schema);
  if (!allAttrs) return null;
  // When marks are stacked (multi-author), find the one that matches the
  // delete attrs being applied — same author, operation, and status.
  const matching = allAttrs.find(a => shouldMergeTrackedAttributes(a, attrs));
  return matching || null;
}

export const updateBlockNodesAttrs = (
  fragment: Fragment,
  predicate: (attrs: Attrs, node: PMNode) => Attrs,
) => {
  const updatedNodes: PMNode[] = [];
  fragment.forEach(child => {
    if (!child.isBlock) {
      updatedNodes.push(child);
      return;
    }
    const newContent = child.content.size
      ? updateBlockNodesAttrs(child.content, predicate)
      : child.content;
    const newAttrs = predicate(child.attrs, child);
    updatedNodes.push(child.type.create(newAttrs, newContent, child.marks));
  });
  return Fragment.fromArray(updatedNodes);
};

export const isTrackedRecord = (value: unknown): value is Partial<TrackedAttrs> =>
  typeof value === "object" && value !== null;

/**
 * The records a mark carries. It holds an array or a lone object depending on
 * the mark, and this data arrives from saved and synced documents, so each
 * entry is checked rather than assumed.
 */
export function markRecords(mark: Mark): Partial<TrackedAttrs>[] {
  const value: unknown = mark.attrs.dataTracked;
  return (Array.isArray(value) ? value : [value]).filter(isTrackedRecord);
}

/**
 * Replaces the records on a mark across one text node, in the shape the mark
 * already stores them. A review mark is nothing without its record, so losing
 * the last one removes it; a formatting mark stays, with none left to review.
 */
export function replaceMarkRecords(
  tr: Transaction,
  pos: number,
  node: PMNode,
  mark: Mark,
  records: Partial<TrackedAttrs>[],
) {
  const storedAsArray = Array.isArray(mark.attrs.dataTracked);
  tr.removeMark(pos, pos + node.nodeSize, mark);
  if (!storedAsArray && !records.length) return;
  tr.addMark(pos, pos + node.nodeSize, mark.type.create({
    ...mark.attrs,
    dataTracked: storedAsArray ? records : records[0],
  }));
}

/**
 * Records without one change's. Accepts either shape `dataTracked` is written
 * in — an array on a node, a lone object on a mark — because ProseMirror types
 * the attr `any`, and a `.filter` on the object form throws.
 */
export function excludeFromTracked(
  dataTracked: Partial<TrackedAttrs> | Partial<TrackedAttrs>[] | null | undefined,
  changeIdToExclude: string,
) {
  if (!dataTracked) return null;
  const records = Array.isArray(dataTracked) ? dataTracked : [dataTracked];
  const remaining = records.filter(c => c.id !== changeIdToExclude);
  return remaining.length ? remaining : null;
}
