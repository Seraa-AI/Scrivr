import { EditorState, type Node, type Step, type Transaction } from "@scrivr/core/pm";
import { findChanges } from "../findChanges";
import { getBlockInlineTrackedData, type NewEmptyAttrs } from "../helpers";
import type { TrackedAttrs } from "../types";

/** An edit inside a creation either folds into it or depends on its existence. */
export function compositionAttrs(doc: Node, step: Step, attrs: NewEmptyAttrs): NewEmptyAttrs {
  const at = "from" in step ? step.from : "pos" in step ? step.pos : undefined;
  if (typeof at !== "number") return attrs;
  const $pos = doc.resolve(at);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const creation = getBlockInlineTrackedData($pos.node(depth))?.find(c => c.operation === "insert" && c.status === "pending");
    if (!creation?.id) continue;
    const id = creation.creationId ?? creation.id;
    return creation.authorID === attrs.authorID && !creation.foldingClosed
      ? { ...attrs, creationId: id }
      : { ...attrs, dependsOn: [id] };
  }
  return attrs;
}

/** Persist the boundary: reviewing a dependent later must not reopen folding. */
export function closeDependentCreations(tr: Transaction): void {
  const changes = findChanges(EditorState.create({ doc: tr.doc })).pending;
  const closed = new Set<string>();
  for (const change of changes) {
    for (const id of change.dataTracked.dependsOn ?? []) closed.add(id);
    if (change.type !== "node-change" || change.dataTracked.operation !== "insert") continue;
    if (changes.some(other => other.id !== change.id && other.from >= change.from && other.to <= change.to &&
      other.dataTracked.authorID !== change.dataTracked.authorID)) closed.add(change.dataTracked.creationId ?? change.id);
  }
  if (!closed.size) return;
  const close = (record: Partial<TrackedAttrs>): Partial<TrackedAttrs> =>
    !record.foldingClosed && closed.has(record.creationId ?? record.id ?? "")
      ? { ...record, foldingClosed: true } : record;
  const update = (value: Partial<TrackedAttrs> | Partial<TrackedAttrs>[] | null | undefined) => {
    if (!value) return value;
    if (!Array.isArray(value)) return close(value);
    const next = value.map(close);
    return next.some((entry, i) => entry !== value[i]) ? next : value;
  };
  tr.doc.descendants((node, pos) => {
    const dataTracked = update(node.attrs.dataTracked);
    if (!node.isText && dataTracked !== node.attrs.dataTracked) tr.setNodeMarkup(pos, undefined, { ...node.attrs, dataTracked }, node.marks);
    for (const mark of node.marks) {
      const next = update(mark.attrs.dataTracked);
      if (next === mark.attrs.dataTracked) continue;
      tr.removeMark(pos, pos + node.nodeSize, mark);
      tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, dataTracked: next }));
    }
  });
}
