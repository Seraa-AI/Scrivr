import { AddMarkStep, Attrs, Fragment, Mark, Node as PMNode, RemoveMarkStep, Schema, type Step, type Transaction } from "@scrivr/core/pm";

import { CHANGE_OPERATION, CHANGE_STATUS, type ReplacedMark, TrackedAttrs } from "./types";

export function genId(): string {
  return crypto.randomUUID();
}

import { isTrackedMark, stableStringify } from "@scrivr/core";
export { isTrackedMark } from "@scrivr/core";

export const toReplacedMark = (mark: Mark): ReplacedMark => {
  const { dataTracked: _tracking, ...attrs } = mark.attrs;
  return { type: mark.type.name, attrs };
};

/**
 * The marks a record says to put back, as `schema` makes them, untracked.
 * Records arrive from saved and synced documents, so an entry the schema
 * cannot make — an unknown or review type, attrs it refuses — is left out
 * rather than failing the review.
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
      return [untracked(markType.create(attrs))];
    } catch (e) {
      console.warn("track-changes: a replaced mark this schema refuses was left out", entry, e);
      return [];
    }
  });
}

/** A mark as agreed text carries it: without the records that track it. */
export const untracked = (mark: Mark): Mark =>
  isValidTrackableMark(mark) ? mark.type.create({ ...mark.attrs, dataTracked: [] }) : mark;

/** Whether setting `mark` takes `other` off the text, as a colour does another colour. */
export const excludes = (mark: Mark, other: Mark): boolean => !other.eq(mark) && !other.isInSet(mark.addToSet([other]));

/**
 * What rejecting `mark`, set over text carrying `marks`, must put back: the
 * agreed formatting it takes off, as one ordered set. A suggestion it takes
 * off was never agreed, so it gives back what it replaced in turn.
 */
export function restoredOnReject(mark: Mark, marks: readonly Mark[]): readonly Mark[] {
  return Mark.setFrom(
    marks
      .filter(other => excludes(mark, other))
      .flatMap(other => {
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
 * The steps that propose taking `mark` off `from`–`to`. A pending suggestion is
 * withdrawn, and what it replaced was agreed, so removing that is proposed in
 * its place; a pending removal stays agreed; anything else is struck.
 */
export function proposeRemoval(mark: Mark, from: number, to: number, emptyAttrs: NewEmptyAttrs): Step[] {
  const struck = (agreed: Mark) =>
    new AddMarkStep(from, to, agreed.type.create({ ...agreed.attrs, dataTracked: [{ ...createNewDeleteAttrs(emptyAttrs), id: genId() }] }));
  if (isSuggested(mark)) {
    return [new RemoveMarkStep(from, to, mark), ...markRecords(mark).flatMap(r => marksToRestore(r, mark.type.schema)).map(struck)];
  }
  if (markRecords(mark).some(r => r.status === CHANGE_STATUS.pending && r.operation === CHANGE_OPERATION.delete)) {
    return [new AddMarkStep(from, to, untracked(mark))];
  }
  return [struck(untracked(mark))];
}

/** Text from `from` to `to` and the marks it had before the edit being recorded. */
export type FoundPiece = { from: number; to: number; marks: readonly Mark[] };

/** A stretch where setting `mark` changes something, and what rejecting it there restores. */
export type RestoreRun = { from: number; to: number; restored: readonly Mark[] };

/**
 * The stretches of `pieces` where setting `mark` is a change to propose, each
 * with what rejecting it restores, neighbours that restore the same joined.
 * Text that had `mark`, or whose restore is `mark` itself, has nothing to propose.
 */
export function restoreRuns(mark: Mark, pieces: Iterable<FoundPiece>): RestoreRun[] {
  const runs: (RestoreRun & { key: string })[] = [];
  for (const piece of pieces) {
    if (mark.isInSet(piece.marks)) continue;
    const restored = restoredOnReject(mark, piece.marks);
    if (restoresItself(mark, restored)) continue;
    const key = restoredKey(restored);
    const last = runs[runs.length - 1];
    if (last && last.to === piece.from && last.key === key) last.to = piece.to;
    else runs.push({ from: piece.from, to: piece.to, restored, key });
  }
  return runs.map(({ from, to, restored }) => ({ from, to, restored }));
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
