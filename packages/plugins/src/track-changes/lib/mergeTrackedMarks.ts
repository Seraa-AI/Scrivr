import { Mark, Node as PMNode, Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";
import { stableStringify } from "@scrivr/core";

import { genId, isValidTrackableMark, shouldMergeTrackedAttributes } from "../helpers";
import { ChangeStep, DeleteNodeStep, DeleteTextStep } from "../types";
import { ExposedFragment, TrackedAttrs } from "../types";

/**
 * Matches deleted to inserted content and returns the first pos they differ and the updated ChangeStep list.
 * Based on https://github.com/ProseMirror/prosemirror-model/blob/master/src/diff.ts
 */
export function matchInserted(
  matchedDeleted: number,
  deleted: ChangeStep[],
  inserted: ExposedFragment,
): [number, ChangeStep[]] {
  let matched: [number, ChangeStep[]] = [matchedDeleted, deleted];
  for (let i = 0; ; i += 1) {
    if (inserted.childCount === i) return matched;

    const insNode = inserted.child(i);
    // @ts-expect-error union narrowing
    const adjDeleted: DeleteTextStep | DeleteNodeStep | undefined = matched[1].find(
      d =>
        (d.type === "delete-text" && Math.max(d.pos, d.from) === matched[0]) ||
        (d.type === "delete-node" && d.pos === matched[0]),
    );

    if (insNode.type !== adjDeleted?.node?.type) {
      return matched;
    } else if (insNode.isText && adjDeleted?.node) {
      continue;
    } else if (insNode.content.size > 0 || adjDeleted?.node.content.size > 0) {
      matched = matchInserted(
        matched[0] + 1,
        matched[1].filter(d => d !== adjDeleted),
        insNode.content as ExposedFragment,
      );
    } else {
      matched = [matched[0] + insNode.nodeSize, matched[1].filter(d => d !== adjDeleted)];
    }

    const { dataTracked, ...newAttrs } = insNode.attrs || {};
    matched[1].push({
      pos: adjDeleted.pos,
      type: "update-node-attrs",
      node: adjDeleted.node,
      newAttrs,
    });
  }
}

const assignId = (
  attrs: Partial<TrackedAttrs>,
  leftDataTracked: Partial<TrackedAttrs>,
  rightDataTracked: Partial<TrackedAttrs>,
) => {
  if (attrs.id === leftDataTracked.id || attrs.id === rightDataTracked.id) {
    return { ...attrs, id: genId() };
  }
  return attrs;
};

/** The single pending tracking descriptor on a mark, regardless of storage shape. */
function descriptorOf(mark: Mark): Partial<TrackedAttrs> | null {
  const dt = mark.attrs.dataTracked;
  if (!dt) return null;
  // Tracked insert/delete text stores a single object; formatting marks
  // (bold/color/…) store an array of stacked entries.
  if (Array.isArray(dt)) return dt.length > 0 ? dt[dt.length - 1] : null;
  return dt;
}

/** A mark eligible for adjacency-merge: a tracked-text mark or a pending trackable formatting mark. */
function isMergeableTrackedMark(mark: Mark, schema: Schema): boolean {
  if (mark.type === schema.marks.trackedInsert || mark.type === schema.marks.trackedDelete) {
    return descriptorOf(mark) !== null;
  }
  return isValidTrackableMark(mark) && descriptorOf(mark) !== null;
}

/** Equal formatting identity: same mark attrs ignoring the tracking bookkeeping. */
function sameOwnAttrs(a: Mark, b: Mark): boolean {
  const strip = (m: Mark) => {
    const { dataTracked: _drop, ...rest } = m.attrs;
    return rest;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/**
 * Merges adjacent tracked marks at a position so one logical change isn't split
 * into many. Covers tracked insert/delete text AND formatting marks
 * (bold/highlight/color/…): a run of the same mark, same author, operation and
 * status collapses to one tracking id — the same grouping typing already gets,
 * now for formatting. Marks with different OWN attrs (e.g. two colors) never
 * merge. Merging is keyed on userID + operation + status.
 */
export function mergeTrackedMarks(pos: number, doc: PMNode, newTr: Transaction, schema: Schema) {
  const resolved = doc.resolve(pos);
  const { nodeAfter, nodeBefore } = resolved;

  if (!nodeAfter || !nodeBefore) return;

  const leftMarks = nodeBefore.marks.filter(m => isMergeableTrackedMark(m, schema));
  const rightMarks = nodeAfter.marks.filter(m => isMergeableTrackedMark(m, schema));

  if (leftMarks.length === 0 || rightMarks.length === 0) return;

  const fromStartOfMark = pos - nodeBefore.nodeSize;
  const toEndOfMark = pos + nodeAfter.nodeSize;

  // Merge all matching pairs across stacked marks (supports multi-author coexistence).
  for (const leftMark of leftMarks) {
    // Same type AND same formatting attrs — never fuse two different colors.
    const rightMark = rightMarks.find(m => m.type === leftMark.type && sameOwnAttrs(m, leftMark));
    if (!rightMark) continue;

    const leftDataTracked = descriptorOf(leftMark);
    const rightDataTracked = descriptorOf(rightMark);
    if (!leftDataTracked || !rightDataTracked) continue;

    // Already the same change — no need to regenerate the ID (would fragment the group).
    if (leftDataTracked.id && leftDataTracked.id === rightDataTracked.id) continue;

    if (!shouldMergeTrackedAttributes(leftDataTracked, rightDataTracked)) continue;

    const isLeftOlder = (leftDataTracked.createdAt || 0) < (rightDataTracked.createdAt || 0);
    const ancestorAttrs = isLeftOlder ? leftDataTracked : rightDataTracked;
    const merged = assignId({ ...ancestorAttrs, updatedAt: Date.now() }, leftDataTracked, rightDataTracked);
    // Preserve the original storage shape (array for formatting marks, single
    // object for tracked insert/delete text).
    const dataTracked = Array.isArray(leftMark.attrs.dataTracked) ? [merged] : merged;
    const unifiedMark = leftMark.type.create({ ...leftMark.attrs, dataTracked });

    // With excludes:"" marks don't auto-remove each other, so we must explicitly
    // remove both individual marks before adding the unified one. Otherwise the
    // old marks stay stacked and the next merge picks up the wrong ID from [0].
    newTr.removeMark(fromStartOfMark, toEndOfMark, leftMark);
    newTr.removeMark(fromStartOfMark, toEndOfMark, rightMark);
    newTr.addMark(fromStartOfMark, toEndOfMark, unifiedMark);
  }
}
