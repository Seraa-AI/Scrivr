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
import { isMoveShadow } from "./helpers";
import { CHANGE_OPERATION, type TrackedChange } from "./types";

/** Document ranges holding content a pending deletion covers. */
export type ShadowRange = readonly [from: number, to: number];

/** A document's pending deletions, and those that are a move's left-behind copy. */
interface Shadows {
  all: readonly ShadowRange[];
  moves: readonly ShadowRange[];
}

/**
 * Keyed on the document node: a ProseMirror node is immutable, so an edit
 * produces a different object and the cache misses on its own.
 */
const shadowCache = new WeakMap<PMNode, Shadows>();

/** One walk of the document's pending deletions, read both ways below. */
function shadowsOf(doc: PMNode): Shadows {
  const cached = shadowCache.get(doc);
  if (cached) return cached;
  // No tracked-delete mark means the TrackChanges extension is not installed,
  // so nothing in this document can be a shadow and the walk is waste.
  const deletions = doc.type.schema.marks["trackedDelete"]
    ? findChanges(EditorState.create({ doc })).pending.filter((change) => change.dataTracked.operation === CHANGE_OPERATION.delete)
    : [];
  const range = (change: TrackedChange): ShadowRange => [change.from, change.to];
  const shadows = { all: deletions.map(range), moves: deletions.filter(isMoveShadow).map(range) };
  shadowCache.set(doc, shadows);
  return shadows;
}

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
  return shadowsOf(doc).all;
}

/**
 * The ranges a pending move left behind: where a moved block was, a copy of
 * the one now live at its new place. Unlike any other deletion, such a copy is
 * not content of its own.
 */
export function moveShadowRanges(doc: PMNode): readonly ShadowRange[] {
  return shadowsOf(doc).moves;
}

/** Whether a pending deletion covers this node whole. */
export function isShadowNode(node: PMNode, pos: number, ranges: readonly ShadowRange[]): boolean {
  return ranges.some(([from, to]) => from <= pos && pos + node.nodeSize <= to);
}

/**
 * The live node this id names, skipping a pending deletion's shadow.
 *
 * Use it to read or write the block a person sees in a tracked document: an
 * agent's edit, a suggestion. It returns null for an id held
 * only by content proposed for deletion — to ask whether the id is there at all,
 * or to reach a block that is struck through but not yet decided, use core's
 * `findNodeById`. Without track changes the two agree.
 *
 * An id two live blocks carry — only in a document saved before block ids were
 * unique — names neither, and this returns null rather than guess.
 *
 * Pass `ranges`, mapped through your own steps, when resolving many ids against
 * a document you are still editing: each intermediate document misses the
 * cache and would cost a full walk.
 */
export function findLiveNodeById(
  doc: PMNode,
  nodeId: string,
  ranges?: readonly ShadowRange[],
): { node: PMNode; pos: number } | null {
  const shadows = ranges ?? shadowRanges(doc);
  const isLive = (node: PMNode, pos: number) => !isShadowNode(node, pos, shadows);
  const first = findNodeById(doc, nodeId, isLive);
  if (!first) return null;
  const second = findNodeById(doc, nodeId, (node, pos) => pos !== first.pos && isLive(node, pos));
  return second ? null : first;
}
