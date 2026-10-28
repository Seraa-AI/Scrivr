import { EditorState, type Mark, type Node, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { getBlockInlineTrackedData } from "../helpers";
import type { TrackedAttrs } from "../types";

type TrackedRecord = Partial<TrackedAttrs>;

const markRecords = (mark: Mark): TrackedRecord[] => {
  const value = mark.attrs.dataTracked;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

/** Every record id a document carries, on node attrs or marks. */
function recordIds(doc: Node) {
  const ids = new Set<string>();
  doc.descendants(node => {
    for (const record of [...(getBlockInlineTrackedData(node) ?? []), ...node.marks.flatMap(markRecords)]) {
      if (record.id) ids.add(record.id);
    }
  });
  return ids;
}

/**
 * What encloses `pos`, not counting a node starting there: the innermost
 * pending creation, and the innermost deletion this gesture wrote.
 */
function enclosingActs(doc: Node, pos: number, writtenNow: (record: TrackedRecord) => boolean) {
  const $pos = doc.resolve(pos);
  let creation: TrackedRecord | undefined;
  let deletion: TrackedRecord | undefined;
  for (let depth = $pos.depth; depth > 0; depth--) {
    const records = getBlockInlineTrackedData($pos.node(depth)) ?? [];
    creation ??= records.find(record => record.id && record.operation === "insert" && record.status === "pending");
    deletion ??= records.find(record =>
      record.operation === "delete" && record.status === "pending" && !record.moveNodeId && writtenNow(record));
  }
  return { creation, deletion };
}

/**
 * Links each record the gesture wrote to the acts it is part of, decided at the
 * place it landed: one step can write records in several places — a deletion
 * running out of a new paragraph into the next — and only those inside a
 * creation belong to it.
 *
 * An edit inside a creation folds into it or depends on its existence. A
 * deletion inside a node the same author deleted in this gesture is part of
 * that deletion. A record its writer already folded into a creation it built is
 * left alone.
 */
export function composeGestureRecords(tr: Transaction, before: Node): void {
  const existing = recordIds(before);
  const writtenNow = (record: TrackedRecord) => !!record.id && !existing.has(record.id);
  type Acts = ReturnType<typeof enclosingActs>;
  const composed = (record: TrackedRecord, { creation, deletion }: Acts): TrackedRecord => {
    if (!writtenNow(record)) return record;
    let next = record;
    if (deletion?.id && record.operation === "delete" && !record.moveNodeId && deletion.authorID === record.authorID) {
      next = { ...next, deletionId: deletion.id };
    }
    if (creation && !(record.creationId && record.creationId !== record.id)) {
      const id = creation.creationId ?? creation.id!;
      next = creation.authorID === record.authorID && !creation.foldingClosed
        ? { ...next, creationId: id }
        : { ...next, dependsOn: [...new Set([...(record.dependsOn ?? []), id])] };
    }
    return next;
  };
  const composeAll = (records: TrackedRecord[], acts: Acts) => {
    const next = records.map(record => composed(record, acts));
    return next.some((record, i) => record !== records[i]) ? next : records;
  };

  tr.doc.descendants((node, pos) => {
    const records = getBlockInlineTrackedData(node) ?? [];
    const marked = node.marks.filter(mark => markRecords(mark).length);
    if (!records.some(writtenNow) && !marked.some(mark => markRecords(mark).some(writtenNow))) return;
    const acts = enclosingActs(tr.doc, pos, writtenNow);
    if (!acts.creation && !acts.deletion) return;

    const nextRecords = composeAll(records, acts);
    if (!node.isText && nextRecords !== records) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked: nextRecords }, node.marks);
    }
    for (const mark of marked) {
      const entries = markRecords(mark);
      const next = composeAll(entries, acts);
      if (next === entries) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
      tr.addMark(pos, pos + node.nodeSize, mark.type.create({
        ...mark.attrs,
        dataTracked: Array.isArray(mark.attrs.dataTracked) ? next : next[0],
      }));
    }
  });
}

/** Persist the boundary: reviewing a dependent later must not reopen folding. */
export function closeDependentCreations(tr: Transaction): void {
  const changes = findChanges(EditorState.create({ doc: tr.doc })).pending;
  const closed = new Set<string>();
  for (const change of changes) {
    for (const id of change.dataTracked.dependsOn ?? []) closed.add(id);
    if (change.type !== "node-change" || change.dataTracked.operation !== "insert") continue;
    if (changes.some(other => other.id !== change.id && other.from >= change.from && other.to <= change.to &&
      other.dataTracked.authorID !== change.dataTracked.authorID)) closed.add(change.dataTracked.creationId ?? change.id);
  }
  if (!closed.size) return;
  const close = (record: Partial<TrackedAttrs>): Partial<TrackedAttrs> =>
    !record.foldingClosed && closed.has(record.creationId ?? record.id ?? "")
      ? { ...record, foldingClosed: true } : record;
  const update = (value: Partial<TrackedAttrs> | Partial<TrackedAttrs>[] | null | undefined) => {
    if (!value) return value;
    if (!Array.isArray(value)) return close(value);
    const next = value.map(close);
    return next.some((entry, i) => entry !== value[i]) ? next : value;
  };
  tr.doc.descendants((node, pos) => {
    const dataTracked = update(node.attrs.dataTracked);
    if (!node.isText && dataTracked !== node.attrs.dataTracked) tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked }, node.marks);
    for (const mark of node.marks) {
      const next = update(mark.attrs.dataTracked);
      if (next === mark.attrs.dataTracked) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
      tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, dataTracked: next }));
    }
  });
}
