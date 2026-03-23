import { Node as PMNode, Schema } from "prosemirror-model";
import { Transaction } from "prosemirror-state";

import { shouldMergeTrackedAttributes } from "../helpers";
import { ChangeStep, DeleteNodeStep, DeleteTextStep } from "../types";
import { ExposedFragment, TrackedAttrs } from "../types";

const genId = () => Math.random().toString(36).slice(2, 10);

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

/**
 * Merges tracked marks between text nodes at a position
 *
 * Will work for any nodes that use tracked_insert or tracked_delete marks which may not be preferrable
 * if used for block nodes (since we possibly want to show the individual changed nodes).
 * Merging is done based on the userID, operation type and status.
 * @param pos
 * @param doc
 * @param newTr
 * @param schema
 */
export function mergeTrackedMarks(pos: number, doc: PMNode, newTr: Transaction, schema: Schema) {
  const resolved = doc.resolve(pos);
  const { nodeAfter, nodeBefore } = resolved;

  if (!nodeAfter || !nodeBefore) return;

  const leftMarks = nodeBefore.marks.filter(
    m => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete,
  );
  const rightMarks = nodeAfter.marks.filter(
    m => m.type === schema.marks.tracked_insert || m.type === schema.marks.tracked_delete,
  );

  if (leftMarks.length === 0 || rightMarks.length === 0) return;

  const fromStartOfMark = pos - nodeBefore.nodeSize;
  const toEndOfMark = pos + nodeAfter.nodeSize;

  // Merge all matching pairs across stacked marks (supports multi-author coexistence).
  for (const leftMark of leftMarks) {
    const rightMark = rightMarks.find(m => m.type === leftMark.type);
    if (!rightMark) continue;

    const leftDataTracked: Partial<TrackedAttrs> = leftMark.attrs.dataTracked;
    const rightDataTracked: Partial<TrackedAttrs> = rightMark.attrs.dataTracked;

    // Already the same change — no need to regenerate the ID (would fragment the group).
    if (leftDataTracked.id && leftDataTracked.id === rightDataTracked.id) continue;

    if (!shouldMergeTrackedAttributes(leftDataTracked, rightDataTracked)) continue;

    const isLeftOlder = (leftDataTracked.createdAt || 0) < (rightDataTracked.createdAt || 0);
    const ancestorAttrs = isLeftOlder ? leftDataTracked : rightDataTracked;
    const dataTracked = { ...ancestorAttrs, updatedAt: Date.now() };
    const unifiedMark = leftMark.type.create({
      ...leftMark.attrs,
      dataTracked: assignId(dataTracked, leftDataTracked, rightDataTracked),
    });

    // With excludes:"" marks don't auto-remove each other, so we must explicitly
    // remove both individual marks before adding the unified one. Otherwise the
    // old marks stay stacked and the next merge picks up the wrong ID from [0].
    newTr.removeMark(fromStartOfMark, toEndOfMark, leftMark);
    newTr.removeMark(fromStartOfMark, toEndOfMark, rightMark);
    newTr.addMark(fromStartOfMark, toEndOfMark, unifiedMark);
  }
}
