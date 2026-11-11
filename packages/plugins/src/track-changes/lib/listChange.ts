import { isListType } from "@scrivr/core";
import { Node as PMNode, ReplaceAroundStep, Transaction } from "@scrivr/core/pm";

import { addTrackIdIfDoesntExist, getBlockInlineTrackedData, NewEmptyAttrs } from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, ListLevel } from "../types";
import { buildLists, listLeaves, sameList, topLevelRange } from "./listStructure";
import { addedBy } from "./deleteBreak";

/** A former place names lists, not the changes recorded on them then. */
const withoutRecords = (level: ListLevel): ListLevel => ({
  ...level,
  attrs: { ...level.attrs, dataTracked: null },
  item: { ...level.item, dataTracked: null },
});

interface ListMove {
  pos: number;
  oldList: ListLevel[];
  newList: ListLevel[];
  /** Its lists look the same but are not the ones it sat in, as when a list splits. */
  relisted: boolean;
}

/**
 * The blocks an edit moved between lists, when that is all it did: the same
 * blocks, unchanged and in the same order, only sitting in different lists.
 */
export function listMovesOnly(tr: Transaction): ListMove[] | null {
  // Lists are made, unmade and nested by wrapping and lifting; typing never needs the walk.
  if (!tr.steps.some(step => step instanceof ReplaceAroundStep)) return null;
  const was = listLeaves(tr.docs[0]!);
  const now = listLeaves(tr.doc);
  if (was.length !== now.length) return null;
  const moved: ListMove[] = [];
  for (let i = 0; i < now.length; i++) {
    const before = was[i]!;
    const after = now[i]!;
    if (!before.node.eq(after.node)) return null;
    const relisted = before.listsAt.some((at, depth) => tr.mapping.map(at) !== after.listsAt[depth]);
    if (relisted || !sameList(before.list, after.list)) {
      moved.push({ pos: after.pos, oldList: before.list.map(withoutRecords), newList: after.list, relisted });
    }
  }
  return moved.length ? moved : null;
}

/**
 * Records each moved block's place before the edit, as Word records a
 * paragraph's former numbering. The blocks one edit moved are one change. A
 * block its author already moved keeps its first place, and one moved back
 * there has nothing left to record. A block its author added is still their
 * proposal, so where it sits is part of that proposal and not a change of its own.
 */
export function recordListChange(moves: ListMove[], tr: Transaction, attrs: NewEmptyAttrs) {
  let first: string | undefined;
  for (const { pos, oldList, newList, relisted } of moves) {
    const node = tr.doc.nodeAt(pos);
    if (!node || addedBy(node, attrs.authorID, [CHANGE_OPERATION.insert])) continue;
    const records = getBlockInlineTrackedData(node) ?? [];
    const earlier = records.find(record =>
      record.operation === CHANGE_OPERATION.list_change &&
      record.status === CHANGE_STATUS.pending &&
      record.authorID === attrs.authorID);
    const original = earlier && "oldList" in earlier ? earlier.oldList : oldList;
    const kept = records.filter(record => record !== earlier);
    if (relisted || !sameList(original, newList)) {
      const record = addTrackIdIfDoesntExist({
        ...attrs,
        operation: CHANGE_OPERATION.list_change,
        oldList: original,
        ...(first ? { continuesId: first } : {}),
      });
      first ??= record.id;
      kept.push(record);
    }
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked: kept.length ? kept : null }, node.marks);
  }
}

/**
 * Puts blocks whose list change was rejected back where they sat, rebuilding
 * the lists around them. The lists either side are rebuilt too, so a block
 * returning to a list it left rejoins it.
 *
 * Returns where a position before the rebuild ends up: inside a block, the same
 * place in that block, which keeps the caret in the text it was in. Replacing
 * the lists wholesale would otherwise map it past them.
 */
export function restoreListPlaces(tr: Transaction, ids: ReadonlySet<string>): (pos: number) => number {
  const leaves = listLeaves(tr.doc);
  const rejected = (node: PMNode) =>
    (getBlockInlineTrackedData(node) ?? []).find(record => record.id !== undefined && ids.has(record.id));
  const touched = leaves.filter(leaf => rejected(leaf.node));
  if (!touched.length) return pos => pos;

  let { from, to } = topLevelRange(tr.doc, touched[0]!.pos, touched[touched.length - 1]!.pos + 1);
  const $from = tr.doc.resolve(from);
  if ($from.nodeBefore && isListType($from.nodeBefore.type)) from -= $from.nodeBefore.nodeSize;
  const after = tr.doc.nodeAt(to);
  if (after && isListType(after.type)) to += after.nodeSize;

  const before = leaves.filter(leaf => leaf.pos >= from && leaf.pos < to);
  const rebuilt = buildLists(
    before.map(leaf => {
      const record = rejected(leaf.node);
      if (!record || !("oldList" in record)) return leaf;
      const kept = (getBlockInlineTrackedData(leaf.node) ?? []).filter(other => other !== record);
      const node = leaf.node.type.create(
        { ...leaf.node.attrs, dataTracked: kept.length ? kept : null },
        leaf.node.content,
        leaf.node.marks,
      );
      // The item a block sits in moves with it, records and all.
      const own = leaf.list[leaf.list.length - 1];
      const list = own && record.oldList.length
        ? [...record.oldList.slice(0, -1), { ...record.oldList[record.oldList.length - 1]!, item: own.item }]
        : record.oldList;
      return { node, list };
    }),
    tr.doc.type.schema,
  );
  tr.replaceWith(from, to, rebuilt);

  const replaced = tr.steps[tr.steps.length - 1]!.getMap();
  const end = replaced.map(to);
  const rebuiltLeaves = listLeaves(tr.doc).filter(leaf => leaf.pos >= from && leaf.pos < end);
  return pos => {
    const index = before.findIndex(leaf => leaf.pos < pos && pos < leaf.pos + leaf.node.nodeSize);
    const moved = rebuiltLeaves[index];
    return index >= 0 && moved ? moved.pos + (pos - before[index]!.pos) : replaced.map(pos);
  };
}
