import { EditorState, type Transaction, type Node, type Mapping } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { getBlockInlineTrackedData } from "../helpers";
import type { NodeChange } from "../types";

/** Independent review identities live on the transported copy, never its shadow. */
export function normalizeMoveShadows(tr: Transaction): void {
  const clean = (node: Node, pos: number, moveNodeId: string, root: boolean) => {
    const records = getBlockInlineTrackedData(node) ?? [];
    const retained = records.filter(record =>
      (record.operation === "delete" && record.moveNodeId === moveNodeId) ||
      (root && record.operation === "move"),
    );
    if (!node.isText && retained.length !== records.length) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked: retained.length ? retained : null }, node.marks);
    }
    for (const mark of node.marks) {
      const value = mark.attrs.dataTracked;
      if (!value) continue;
      const entries = Array.isArray(value) ? value : [value];
      const kept = entries.filter(record => record.operation === "delete" && record.moveNodeId === moveNodeId);
      if (kept.length === entries.length) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
      if (mark.type !== node.type.schema.marks.trackedInsert && mark.type !== node.type.schema.marks.trackedDelete) {
        tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, dataTracked: kept }));
      } else if (kept.length) {
        tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, dataTracked: kept[0] }));
      }
    }
    node.forEach((child, offset) => clean(child, pos + 1 + offset, moveNodeId, false));
  };
  tr.doc.descendants((node, pos) => {
    const shadow = getBlockInlineTrackedData(node)?.find(record => record.operation === "delete" && record.status === "pending" && record.moveNodeId);
    if (!shadow?.moveNodeId) return;
    clean(node, pos, shadow.moveNodeId, true);
    return false;
  });
}

/** Reject placement by transporting the current identity back to its shadow. */
export function rejectMove(tr: Transaction, change: NodeChange, mapping: Mapping): void {
  const current = findChanges(EditorState.create({ doc: tr.doc })).changes;
  const live = current.find(c => c.id === change.id && c.type === "node-change");
  const sources = current.filter((c): c is NodeChange => c.type === "node-change" &&
    c.dataTracked.operation === "delete" && c.dataTracked.moveNodeId === change.dataTracked.moveNodeId);
  const roots = sources.filter(c => !sources.some(parent => parent !== c && parent.from <= c.from && parent.to >= c.to));
  if (!live || roots.length !== 1) throw new Error("Cannot resolve the live identity and original placement of this move");
  const source = roots[0]!;
  const node = tr.doc.nodeAt(live.from)!;
  const priorPlacements = (getBlockInlineTrackedData(tr.doc.nodeAt(source.from)!) ?? []).filter(record => record.operation === "move");
  const dataTracked = [...(getBlockInlineTrackedData(node) ?? []).filter(record => record.id !== change.id), ...priorPlacements];
  const transported = node.type.create({ ...node.attrs, dataTracked: dataTracked.length ? dataTracked : null }, node.content, node.marks);
  tr.delete(live.from, live.from + node.nodeSize);
  const removal = tr.steps[tr.steps.length - 1]!.getMap();
  mapping.appendMap(removal);
  const at = removal.map(source.from);
  const shadow = tr.doc.nodeAt(at)!;
  tr.replaceWith(at, at + shadow.nodeSize, transported);
  mapping.appendMap(tr.steps[tr.steps.length - 1]!.getMap());
}
