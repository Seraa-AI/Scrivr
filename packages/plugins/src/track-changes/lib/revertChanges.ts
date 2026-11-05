import { Slice } from "@scrivr/core/pm";
import { EditorState, Transaction } from "@scrivr/core/pm";
import { liftTarget, Mapping, ReplaceAroundStep } from "@scrivr/core/pm";

import { findChanges } from "../findChanges";
import { getBlockInlineTrackedData } from "../helpers";
import { IncompleteChange, NodeChange } from "../types";

/**
 * Undo a paragraph break by giving the split-off content back to the block it
 * came from. Records are read live: the content is transported rather than
 * mapped, so a position taken before this runs says nothing about after it.
 */
export function revertSplitNodeChange(tr: Transaction, change: IncompleteChange) {
  const current = findChanges(EditorState.create({ doc: tr.doc })).changes;
  const live = current.find(c => c.id === change.id);
  const source = current.find(
    c => c.dataTracked.operation === "reference" && c.dataTracked.referenceId === change.id,
  );
  if (!live || !source) throw new Error("Cannot resolve the two halves of this paragraph break");

  const splitOff = tr.doc.nodeAt(live.from)!;
  const carriedReference = current.find(
    c => c.from === live.from && c.dataTracked.operation === "reference",
  );

  tr.delete(live.from, live.to);
  const removal = tr.steps[tr.steps.length - 1]!.getMap();
  const sourceFrom = removal.map(source.from);
  const sourceEnd = removal.map(source.to) - 1;
  tr.insert(sourceEnd, splitOff.content);
  if (splitOff.type.name === "list_item") tr.join(sourceEnd);

  const sourceNode = tr.doc.nodeAt(sourceFrom)!;
  // A later break's other half now hangs off the block this content rejoined.
  const records = (getBlockInlineTrackedData(sourceNode) ?? [])
    .map(record => (carriedReference && record.operation === "reference" ? carriedReference.dataTracked : record));
  tr.setNodeMarkup(
    sourceFrom,
    undefined,
    { ...sourceNode.attrs, dataTracked: records.length ? records : null },
    sourceNode.marks,
  );
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
        node => !!(change as NodeChange).node?.type.contentMatch.matchType(node.type),
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
