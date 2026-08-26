import { Node as PMNode, Slice } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { liftTarget, Mapping, ReplaceAroundStep } from "@scrivr/core/pm";

import { ChangeSet } from "../ChangeSet";
import { excludeFromTracked, getBlockInlineTrackedData } from "../helpers";
import { IncompleteChange, NodeChange } from "../types";

export function revertSplitNodeChange(
  tr: Transaction,
  change: IncompleteChange,
  changeSet: ChangeSet,
) {
  const sourceChange = changeSet.changes.find(
    c => c.dataTracked.operation === "reference" && c.dataTracked.referenceId === change.id,
  )!;

  const node = tr.doc.nodeAt(tr.mapping.map(change.from)) as PMNode;

  tr.delete(tr.mapping.map(change.from), tr.mapping.map(change.to));
  tr.replaceWith(
    tr.mapping.map(sourceChange.to - 1),
    tr.mapping.map(sourceChange.to),
    node.content,
  );

  if ((change as NodeChange).node.type.name === "list_item") {
    tr.join(sourceChange.to - 1);
  }

  const childSource = changeSet.changes.find(
    c => c.from === change.from && c.dataTracked.operation === "reference",
  );
  if (childSource) {
    const node = tr.doc.nodeAt(tr.mapping.map(sourceChange.from)) as PMNode;
    const data = getBlockInlineTrackedData(node) || [];
    const dataTracked = data.map(c =>
      c.operation === "reference" ? childSource.dataTracked : c,
    );
    tr.setNodeMarkup(
      tr.mapping.map(sourceChange.from),
      undefined,
      { ...node.attrs, dataTracked },
      node.marks,
    );
  }

  const deleteChange = changeSet.changes.find(
    c => c.dataTracked.operation == "delete" && c.from === sourceChange.from,
  );
  if (deleteChange) {
    const node = tr.doc.nodeAt(tr.mapping.map(deleteChange.from)) as PMNode;
    tr.setNodeMarkup(
      tr.mapping.map(deleteChange.from),
      undefined,
      excludeFromTracked(node.attrs.dataTracked, deleteChange.id),
    );
  }
}

export function revertWrapNodeChange(
  tr: Transaction,
  change: IncompleteChange,
  deleteMap: Mapping,
) {
  const from = tr.mapping.map(change.from);
  const to = tr.mapping.map(change.to);
  const node = tr.doc.nodeAt(from);

  if (node?.isInline) {
    tr.step(new ReplaceAroundStep(from, to, from + 1, to - 1, Slice.empty, 0));
    deleteMap.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
  } else {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const $fromPos = tr.doc.resolve(tr.mapping.map(pos));
      const $toPos = tr.doc.resolve(tr.mapping.map(pos + node.nodeSize - 1));
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
