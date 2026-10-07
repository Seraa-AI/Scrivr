/**
 * Resolving a `nodeId` while tracking is on.
 *
 * A `nodeId` is not unique in a tracked document. Deleting a node keeps it
 * until someone accepts the deletion, so a pending move — a delete at the old
 * place and an insert at the new one — leaves two nodes carrying the same id.
 * Which one `findNodeById` returns then depends on document order: the live
 * copy for a move down the document, the deleted shadow for a move up it.
 *
 * Every consumer that resolves an id against a tracked document wants the live
 * copy. Writing into the shadow succeeds, reports success, and then evaporates
 * when the deletion is accepted. So the rule lives here, once, rather than at
 * each caller.
 */
import { EditorState } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { findNodeById } from "@scrivr/core";

import { findChanges } from "./findChanges";
import { CHANGE_OPERATION, CHANGE_STATUS } from "./types";

/** Document ranges holding content a pending deletion covers. */
type ShadowRange = readonly [from: number, to: number];

/**
 * Keyed on the document node: a ProseMirror node is immutable, so an edit
 * produces a different object and the cache misses on its own. The same
 * reasoning `LayoutCoordinator` uses for its measure cache.
 */
const shadowCache = new WeakMap<PMNode, readonly ShadowRange[]>();

/**
 * The ranges a pending deletion covers in this document.
 *
 * A node-level deletion covers the node's whole range, which is what makes a
 * shadow identifiable even when nothing about the node itself says so — an
 * empty paragraph and the children of a deleted list both carry no tracked
 * marks. A text-level deletion covers only the text, so a block whose words
 * are all struck through stays live, which is correct: it is still there.
 */
export function shadowRanges(doc: PMNode): readonly ShadowRange[] {
  const cached = shadowCache.get(doc);
  if (cached) return cached;

  // No tracked-delete mark means the TrackChanges extension is not installed,
  // so nothing in this document can be a shadow and the walk is waste.
  const ranges: ShadowRange[] = doc.type.schema.marks["trackedDelete"]
    ? findChanges(EditorState.create({ doc }))
        .changes.filter(
          (change) =>
            change.dataTracked.operation === CHANGE_OPERATION.delete &&
            change.dataTracked.status === CHANGE_STATUS.pending,
        )
        .map((change) => [change.from, change.to] as const)
    : [];

  shadowCache.set(doc, ranges);
  return ranges;
}

/** Whether a pending deletion covers this node whole. */
export function isShadowNode(
  doc: PMNode,
  node: PMNode,
  pos: number,
  ranges: readonly ShadowRange[] = shadowRanges(doc),
): boolean {
  return ranges.some(([from, to]) => from <= pos && pos + node.nodeSize <= to);
}

/**
 * The live node this id names, skipping a pending deletion's shadow.
 *
 * `ranges` is for a caller resolving several ids against a document it is
 * editing: pass ranges mapped through its own steps, because the cache is
 * keyed on the document those ranges were read from.
 */
export function findLiveNodeById(
  doc: PMNode,
  nodeId: string,
  ranges?: readonly ShadowRange[],
): { node: PMNode; pos: number } | null {
  const shadows = ranges ?? shadowRanges(doc);
  return findNodeById(doc, nodeId, (node, pos) => !isShadowNode(doc, node, pos, shadows));
}
