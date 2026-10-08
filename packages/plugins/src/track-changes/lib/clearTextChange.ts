import type { Mark, Transaction } from "@scrivr/core/pm";

/** Review removes the selected identity, never every author's mark of a type. */
export function clearTextChange(tr: Transaction, from: number, to: number, id: string): void {
  const ranges: Array<{ from: number; to: number; mark: Mark }> = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    for (const mark of node.marks) {
      if ((mark.type === tr.doc.type.schema.marks.trackedInsert ||
           mark.type === tr.doc.type.schema.marks.trackedDelete) &&
          mark.attrs.dataTracked?.id === id) {
        ranges.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), mark });
      }
    }
  });
  for (const range of ranges) tr.removeMark(range.from, range.to, range.mark);
}
