import type { Node } from "@scrivr/core/pm";
import { getBlockInlineTrackedData } from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS, type TrackedAttrs } from "../types";

/** Read all records, including stacked inline and formatting changes. */
function records(node: Node): Partial<TrackedAttrs>[] {
  return [
    ...(getBlockInlineTrackedData(node) ?? []),
    ...node.marks.flatMap(mark => {
      const value = mark.attrs.dataTracked;
      return value ? (Array.isArray(value) ? value : [value]) : [];
    }),
  ];
}

/**
 * A deletion can cancel one's own pending insertion only while it owns all
 * pending work it would erase. Shared by text and structural writers; storage
 * shape and mark ordering must not change the authorship rule.
 */
export function canCancelInsertion(node: Node, authorID: string): boolean {
  // A formatting insertion proposes a mark, not the existence of the text.
  // Only the content's own representation can establish cancellable ownership.
  const insertions: Partial<TrackedAttrs>[] = node.isText
    ? node.marks.filter(mark => mark.type === node.type.schema.marks.trackedInsert)
      .flatMap(mark => mark.attrs.dataTracked ? [mark.attrs.dataTracked] : [])
    : getBlockInlineTrackedData(node) ?? [];
  const ownInsertion = insertions.some(record =>
    !record.foldingClosed && record.authorID === authorID && record.status === CHANGE_STATUS.pending &&
    (record.operation === CHANGE_OPERATION.insert || record.operation === CHANGE_OPERATION.wrap_with_node),
  );
  if (!ownInsertion) return false;
  const foreignPending = (current: Node) => records(current).some(record =>
    record.status === CHANGE_STATUS.pending && record.authorID !== authorID,
  );
  if (foreignPending(node)) return false;
  let hasForeignWork = false;
  node.descendants(child => {
    if (foreignPending(child)) hasForeignWork = true;
    return !hasForeignWork;
  });
  return !hasForeignWork;
}
