/**
 * splitRangeForNewMark
 *
 * Applies a new tracked mark (trackedInsert or trackedDelete) to [from, to)
 * respecting multi-author coexistence:
 *
 *   - Same author + same type on a text node → skip (no duplicate stacking).
 *   - Different author or different type → apply the new mark alongside the
 *     existing one (allowed because excludes: "").
 *
 * Conflict detection (isConflict flag) is intentionally NOT done here.
 * It is computed at read-time in findChanges() so that the document mark
 * structure is never mutated for display purposes, preventing fragmentation.
 *
 * Used by applyDiffAsSuggestion for the AI suggestion pipeline.
 */

import type { Mark, MarkType, Node as PMNode, Schema } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

export interface SplitRangeOptions {
  mark: Mark;
  from: number;
  to: number;
  schema: Schema;
}

/**
 * Apply `mark` to [from, to), skipping sub-ranges where the same author
 * already has an identical-type mark (prevents duplicate stacking).
 *
 * Returns true if the mark was applied to at least one sub-range.
 */
export function splitRangeForNewMark(
  tr: Transaction,
  { mark, from, to, schema }: SplitRangeOptions,
): boolean {
  const insertType = schema.marks.trackedInsert;
  const deleteType = schema.marks.trackedDelete;
  if (!insertType || !deleteType) {
    tr.addMark(from, to, mark);
    return true;
  }

  const newAuthorID: string =
    (mark.attrs.dataTracked as { authorID?: string } | null)?.authorID ?? "";

  const isTrackedMark = (m: Mark): boolean =>
    m.type === insertType || m.type === deleteType;

  let applied = false;

  // Collect ranges to apply (don't modify doc during traversal)
  const applyRanges: Array<{ from: number; to: number }> = [];

  tr.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
    if (!node.isText) return true;

    const nodeFrom = Math.max(pos, from);
    const nodeTo   = Math.min(pos + node.nodeSize, to);
    if (nodeFrom >= nodeTo) return false;

    const existingTracked = node.marks.filter(isTrackedMark);

    // Skip if the same author already has this mark type on this node
    const isDuplicate = existingTracked.some(
      m =>
        m.type === mark.type &&
        (m.attrs.dataTracked as { authorID?: string } | null)?.authorID === newAuthorID,
    );

    if (!isDuplicate) {
      applyRanges.push({ from: nodeFrom, to: nodeTo });
    }

    return false;
  });

  for (const range of applyRanges) {
    tr.addMark(range.from, range.to, mark);
    applied = true;
  }

  return applied;
}

/**
 * Convenience wrapper: build and apply a trackedDelete mark for [from, to).
 */
export function applyTrackedDelete(
  tr: Transaction,
  from: number,
  to: number,
  dataTracked: Record<string, unknown>,
  schema: Schema,
): boolean {
  const deleteType = schema.marks.trackedDelete as MarkType | undefined;
  if (!deleteType) return false;
  const mark = deleteType.create({ dataTracked });
  return splitRangeForNewMark(tr, { mark, from, to, schema });
}

/**
 * Convenience wrapper: build and apply a trackedInsert mark for [from, to).
 */
export function applyTrackedInsert(
  tr: Transaction,
  from: number,
  to: number,
  dataTracked: Record<string, unknown>,
  schema: Schema,
): boolean {
  const insertType = schema.marks.trackedInsert as MarkType | undefined;
  if (!insertType) return false;
  const mark = insertType.create({ dataTracked });
  return splitRangeForNewMark(tr, { mark, from, to, schema });
}
