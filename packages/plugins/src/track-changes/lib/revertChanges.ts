import { Node as PMNode, Slice } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { canJoin, liftTarget, Mapping, ReplaceAroundStep, ReplaceStep } from "@scrivr/core/pm";

import { findChanges } from "../findChanges";
import { getBlockInlineTrackedData } from "../helpers";
import { IncompleteChange } from "../types";
import { splitDepthOf } from "../step-trackers/qualifiers";

/**
 * Undo a paragraph break by giving the split-off content back to the block it
 * came from. Halves that still sit side by side are joined, which leaves the
 * content, and the caret in it, where it is. Halves pulled apart have their
 * content carried across instead. Records are read live either way: carried
 * content can't be mapped across. A list item's break is undone at both of
 * its levels, the item and its paragraph.
 */
export function revertSplitNodeChange(tr: Transaction, change: IncompleteChange) {
  const current = findChanges(EditorState.create({ doc: tr.doc })).changes;
  const live = current.find(c => c.id === change.id);
  const source = current.find(
    c => c.dataTracked.operation === "reference" && c.dataTracked.referenceId === change.id,
  );
  const splitOff = live && tr.doc.nodeAt(live.from);
  const sourceBefore = source && tr.doc.nodeAt(source.from);
  if (!live || !source || !splitOff || !sourceBefore) throw new Error("Cannot resolve the two halves of this paragraph break");

  const depth = Math.max(1, splitDepthOf(sourceBefore, splitOff));
  // The rejoined block is the paragraph that was split, under the id it had,
  // and each level inside it takes its id from the half that kept that one.
  const originalNodeId = "originalNodeId" in source.dataTracked && typeof source.dataTracked.originalNodeId === "string" ? source.dataTracked.originalNodeId : undefined;
  const keptIds = originalNodeId !== undefined && splitOff.attrs["nodeId"] === originalNodeId
    ? idsDown(splitOff, (node) => node.firstChild)
    : idsDown(sourceBefore, (node) => node.lastChild);
  // Inside the first half, the blocks the second half's content joins.
  const joinedInto = lastBlocksDown(sourceBefore, source.from).slice(0, depth - 1);
  const carriedReference = current.find(
    c => c.from === live.from && c.dataTracked.operation === "reference",
  );

  const stepsBefore = tr.steps.length;
  let sourceFrom = source.from;
  if (source.to === live.from && joinsAt(tr.doc, live.from, depth)) {
    tr.join(live.from, depth);
  } else {
    tr.delete(live.from, live.to);
    const removal = tr.mapping.slice(stepsBefore);
    sourceFrom = removal.map(source.from);
    const end = removal.map(source.to) - depth;
    tr.replace(end, end, new Slice(splitOff.content, depth - 1, 0));
  }

  const sourceNode = tr.doc.nodeAt(sourceFrom);
  if (!sourceNode) throw new Error("Cannot resolve the rejoined block of this paragraph break");
  // A later break's other half now hangs off the block this content rejoined,
  // and a deletion of this break has nothing left to delete.
  const records = (getBlockInlineTrackedData(sourceNode) ?? [])
    .filter(record => record.operation !== "node_join")
    .map(record => (carriedReference && record.operation === "reference" ? carriedReference.dataTracked : record));
  tr.setNodeMarkup(
    sourceFrom,
    undefined,
    {
      ...sourceNode.attrs,
      ...(originalNodeId !== undefined ? { nodeId: originalNodeId } : {}),
      dataTracked: records.length ? records : null,
    },
    sourceNode.marks,
  );
  const joined = tr.mapping.slice(stepsBefore);
  joinedInto.forEach((pos, level) => {
    const id = keptIds[level + 1];
    const at = joined.map(pos);
    const node = tr.doc.nodeAt(at);
    if (node && typeof id === "string") tr.setNodeMarkup(at, undefined, { ...node.attrs, nodeId: id }, node.marks);
  });
}

/** The ids of a node and of each node below it along `next`. */
function idsDown(node: PMNode, next: (node: PMNode) => PMNode | null): unknown[] {
  const ids: unknown[] = [];
  for (let at: PMNode | null = node; at && !at.isText; at = next(at)) ids.push(at.attrs["nodeId"]);
  return ids;
}

/** Can the two halves meeting at `pos` be joined at every one of `depth` levels? */
function joinsAt(doc: PMNode, pos: number, depth: number): boolean {
  return depth === 1 ? canJoin(doc, pos) : new ReplaceStep(pos - depth, pos + depth, Slice.empty, true).apply(doc).failed === null;
}

/** Where each last child below `node`, at `pos`, starts, down to its text. */
function lastBlocksDown(node: PMNode, pos: number): number[] {
  const starts: number[] = [];
  for (let at = node, from = pos; at.lastChild && !at.lastChild.isText; ) {
    from += at.nodeSize - 1 - at.lastChild.nodeSize;
    at = at.lastChild;
    starts.push(from);
  }
  return starts;
}

function changedNode(change: IncompleteChange): PMNode | undefined {
  return "node" in change && change.node instanceof PMNode ? change.node : undefined;
}

export function revertWrapNodeChange(
  tr: Transaction,
  change: IncompleteChange,
  deleteMap: Mapping,
) {
  const from = deleteMap.map(change.from);
  const to = deleteMap.map(change.to);
  const node = tr.doc.nodeAt(from);

  if (node?.isInline) {
    tr.step(new ReplaceAroundStep(from, to, from + 1, to - 1, Slice.empty, 0));
    deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
  } else {
    const liftsStartAt = deleteMap.maps.length;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const sinceStart = deleteMap.slice(liftsStartAt);
      const $fromPos = tr.doc.resolve(sinceStart.map(pos));
      const $toPos = tr.doc.resolve(sinceStart.map(pos + node.nodeSize - 1));
      const nodeRange = $fromPos.blockRange(
        $toPos,
        node => !!changedNode(change)?.type.contentMatch.matchType(node.type),
      );
      if (!nodeRange) return;
      const targetLiftDepth = liftTarget(nodeRange);
      if (targetLiftDepth || targetLiftDepth === 0) {
        tr.lift(nodeRange, targetLiftDepth);
        deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
      }
    });
  }
}
