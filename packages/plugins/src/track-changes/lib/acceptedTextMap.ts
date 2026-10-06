/**
 * buildAcceptedTextMap
 *
 * Given a ProseMirror block node, walks its inline content and produces:
 *
 *   acceptedText  — the "accept-all" view of the paragraph: plain text +
 *                   trackedInsert text (already accepted), WITHOUT
 *                   trackedDelete text (those chars would be removed on accept).
 *
 *   decoratedText — pseudo-XML annotated text for AI context:
 *                   <del author="Bob">quick </del><ins author="Bob">agile </ins>
 *
 *   map           — one PosMapEntry per character in acceptedText, pointing back
 *                   to the absolute ProseMirror doc position of that character.
 *                   Use acceptedOffsetToDocPos() to query it.
 *
 * This is the core primitive for the AI suggestion pipeline:
 *   1. Build the map for a paragraph.
 *   2. Send acceptedText + decoratedText to the model.
 *   3. Model returns a proposedText (replacement for acceptedText).
 *   4. Diff acceptedText → proposedText with diffText().
 *   5. Use the map to translate diff offsets to doc positions.
 *   6. Apply the diff as tracked insert/delete marks via splitRangeForNewMark().
 */

import type { Node as PMNode, Schema } from "@scrivr/core/pm";

export interface PosMapEntry {
  /** 0-based index into acceptedText */
  acceptedOffset: number;
  /** Absolute position in the ProseMirror document */
  docPos: number;
}

export interface AcceptedTextMapResult {
  acceptedText: string;
  decoratedText: string;
  map: PosMapEntry[];
}

/**
 * Build the accepted-text map for a single block node.
 *
 * @param node          The block node (e.g. a paragraph).
 * @param nodeStartPos  The absolute ProseMirror position of the START of the
 *                      node (i.e. the position BEFORE the node's opening token,
 *                      as returned by `ResolvedPos.before` or by iterating
 *                      with `doc.nodesBetween`).
 * @param schema        The editor schema (to identify mark types).
 */
export function buildAcceptedTextMap(
  node: PMNode,
  nodeStartPos: number,
  schema: Schema,
): AcceptedTextMapResult {
  const acceptedChars: string[] = [];
  const map: PosMapEntry[] = [];
  const decoratedParts: string[] = [];

  const insertMarkType = schema.marks.trackedInsert;
  const deleteMarkType = schema.marks.trackedDelete;

  // nodeStartPos points BEFORE the node token itself.
  // The first child content starts at nodeStartPos + 1 (skipping the node's
  // own opening token).
  let offset = nodeStartPos + 1;

  node.forEach((child) => {
    const text = child.text ?? "";
    const childLen = child.nodeSize;

    if (!child.isText) {
      // Non-text inline (e.g. inline image) — skip in accepted text,
      // but advance offset.
      offset += childLen;
      return;
    }

    const marks = child.marks;
    const isInsert = insertMarkType
      ? marks.some((m) => m.type === insertMarkType)
      : false;
    const isDelete = deleteMarkType
      ? marks.some((m) => m.type === deleteMarkType)
      : false;

    // Determine the authorID for decoration (use first tracked mark found)
    let authorID: string | undefined;
    for (const m of marks) {
      if (
        m.type === insertMarkType ||
        m.type === deleteMarkType
      ) {
        authorID = (m.attrs.dataTracked as { authorID?: string } | null)
          ?.authorID;
        break;
      }
    }

    if (isDelete) {
      // Deleted text: skip in acceptedText, include in decoratedText only
      decoratedParts.push(
        `<del${authorID ? ` author="${escapeAttr(authorID)}"` : ""}>${escapeXml(text)}</del>`,
      );
      // Do NOT add to acceptedChars / map — these chars won't exist in
      // the accepted view.
    } else {
      // Plain text OR trackedInsert (insertion is already accepted view)
      if (isInsert) {
        decoratedParts.push(
          `<ins${authorID ? ` author="${escapeAttr(authorID)}"` : ""}>${escapeXml(text)}</ins>`,
        );
      } else {
        decoratedParts.push(escapeXml(text));
      }

      // Add each character to the accepted text + map
      for (let ci = 0; ci < text.length; ci++) {
        map.push({
          acceptedOffset: acceptedChars.length,
          docPos: offset + ci,
        });
        acceptedChars.push(text[ci]!);
      }
    }

    offset += childLen;
  });

  return {
    acceptedText: acceptedChars.join(""),
    decoratedText: decoratedParts.join(""),
    map,
  };
}

/**
 * Convert a 0-based offset in acceptedText to the absolute ProseMirror doc
 * position of that character.
 *
 * Returns `null` if the offset is out of range.
 */
export function acceptedOffsetToDocPos(
  map: PosMapEntry[],
  acceptedOffset: number,
): number | null {
  if (acceptedOffset < 0 || acceptedOffset >= map.length) return null;
  return map[acceptedOffset]!.docPos;
}

/**
 * Given a range [startOffset, endOffset) in acceptedText, return the
 * corresponding doc positions [from, to].
 *
 * `to` is the doc position AFTER the last character (exclusive), matching
 * ProseMirror's convention.
 *
 * Returns null if the range is invalid.
 */
export function acceptedRangeToDocRange(
  map: PosMapEntry[],
  startOffset: number,
  endOffset: number,
): { from: number; to: number } | null {
  if (
    startOffset < 0 ||
    endOffset > map.length ||
    startOffset > endOffset
  ) {
    return null;
  }
  if (startOffset === endOffset) {
    // Empty range — insertion point
    const pos = acceptedOffsetToDocPos(map, startOffset);
    if (pos === null) {
      // At the very end — use last entry + 1
      if (map.length === 0) return null;
      return { from: map[map.length - 1]!.docPos + 1, to: map[map.length - 1]!.docPos + 1 };
    }
    return { from: pos, to: pos };
  }
  const from = acceptedOffsetToDocPos(map, startOffset);
  // `to` should be the doc position AFTER the last char in the range.
  // The last char in range is at endOffset - 1.
  const lastCharDocPos = acceptedOffsetToDocPos(map, endOffset - 1);
  if (from === null || lastCharDocPos === null) return null;
  return { from, to: lastCharDocPos + 1 };
}

// ── XML escaping ──────────────────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeXml(text).replace(/"/g, "&quot;");
}

/**
 * Convert a document range to the accepted-text offsets it covers — the
 * inverse of `acceptedRangeToDocRange`.
 *
 * A host works in document positions, because that is what a selection gives
 * it, while the AI suggestion pipeline works in accepted-text offsets. The
 * conversion cannot be done with arithmetic: accepted text omits every run
 * pending deletion and every inline atom, so `docPos - blockStart - 1` is
 * wrong by the length of whatever the range spans — and wrong silently, in
 * exactly the tracked-changes documents this pipeline exists for.
 *
 * Edges that land inside omitted content round outward to the nearest accepted
 * character, so the returned range covers at least what was asked for. A range
 * reaching past the block is clamped to it.
 *
 * Returns `null` when the range is inverted, or when it covers no accepted
 * character at all — a selection over nothing but deleted text has no
 * accepted-text range to name.
 */
export function docRangeToAcceptedRange(
  map: PosMapEntry[],
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (from > to || map.length === 0) return null;

  // First accepted character at or after `from`, and last at or before `to`.
  // Scanning rather than binary-searching: `map` is one entry per character of
  // one block, and the callers are a click and a keystroke.
  let start: number | null = null;
  let end: number | null = null;
  for (const entry of map) {
    if (start === null && entry.docPos >= from) start = entry.acceptedOffset;
    if (entry.docPos < to) end = entry.acceptedOffset;
  }
  if (start === null || end === null || end < start) {
    // A collapsed selection names a point, not a character, so it has an
    // accepted offset even though it covers none.
    if (from === to && start !== null) return { from: start, to: start };
    return null;
  }
  return { from: start, to: end + 1 };
}

/**
 * `buildAcceptedTextMap`, memoised on the block node.
 *
 * The build walks every inline child of the block, and the AI suggestion
 * overlay asks for one per suggested block, per page, on every paint frame —
 * so with `renderMode: "all"` on a long document it is a full inline walk per
 * block at the frame rate.
 *
 * A ProseMirror node is immutable, so the node reference is the invalidation
 * signal: an edit produces a different node and misses the cache on its own,
 * with no staleness flag to keep in step. The position is checked too, because
 * the map holds absolute document positions — an untouched block that text was
 * inserted in front of needs a fresh one.
 */
const acceptedTextMapCache = new WeakMap<
  PMNode,
  { nodeStartPos: number; result: AcceptedTextMapResult }
>();

export function acceptedTextMapFor(
  node: PMNode,
  nodeStartPos: number,
  schema: Schema,
): AcceptedTextMapResult {
  const hit = acceptedTextMapCache.get(node);
  if (hit && hit.nodeStartPos === nodeStartPos) return hit.result;

  const result = buildAcceptedTextMap(node, nodeStartPos, schema);
  acceptedTextMapCache.set(node, { nodeStartPos, result });
  return result;
}
