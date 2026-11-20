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
 *   6. Write the diff as plain edits under trackAsSuggestion(); the engine
 *      records them.
 *
 * A line break reads as "\n", so a proposal can add or remove one.
 */

import { breakOf, describeInlineMark, isTrackedMark, type InlineMark } from "@scrivr/core";
import type { Mark, Node as PMNode, Schema } from "@scrivr/core/pm";

import { getBlockInlineTrackedData, markRecords, proposedForDeletion } from "../helpers";
import { isMarkRemoved } from "../semanticChanges";
import { CHANGE_OPERATION, CHANGE_STATUS } from "../types";

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
  const chars = collectAccepted(node, nodeStartPos, schema);
  return {
    acceptedText: chars.map((cell) => cell.char).join(""),
    decoratedText: decorate(node, schema),
    map: chars.map((cell, acceptedOffset) => ({ acceptedOffset, docPos: cell.docPos })),
  };
}

/** One accepted-view character: its doc position and the formatting marks on it. */
export interface AcceptedChar {
  char: string;
  docPos: number;
  marks: InlineMark[];
}

/**
 * The accepted-view text of a single textblock, character by character,
 * with each one's doc position and formatting marks. It is what the semantic
 * export shows an agent, so it must mirror that extraction exactly, or a
 * verbatim echo diffs as a full rewrite:
 *  - text node → its chars, minus tracked-change marks (trackedDelete text
 *    excluded entirely, matching the review view);
 *  - formatting → its marks, minus any a pending change proposes removing;
 *  - line break → a newline, unless its deletion is pending;
 *  - other inline leaf (e.g. image) → no intrinsic text.
 */
export function collectAccepted(node: PMNode, nodeStart: number, schema: Schema): AcceptedChar[] {
  const deleteType = schema.marks.trackedDelete;

  if (node.isText) {
    if (deleteType && node.marks.some((m) => m.type === deleteType)) return [];
    const marks = formattingMarksOf(node.marks);
    const text = node.text ?? "";
    const out: AcceptedChar[] = [];
    for (let i = 0; i < text.length; i++) out.push({ char: text[i]!, docPos: nodeStart + i, marks });
    return out;
  }
  if (breakOf(node.type) === "line") return proposedForDeletion(node) ? [] : [{ char: "\n", docPos: nodeStart, marks: [] }];
  // A container (a list, a table) has no text of its own: callers read its
  // textblocks one by one, each under its own id.
  if (!node.isTextblock) return [];

  // A textblock: its inline runs in document order, past its opening token.
  const out: AcceptedChar[] = [];
  let offset = nodeStart + 1;
  node.forEach((child) => {
    out.push(...collectAccepted(child, offset, schema));
    offset += child.nodeSize;
  });
  return out;
}

/** PM marks → formatting `InlineMark`s: drop tracked-change marks, marks proposed removed, and `dataTracked`/null attrs. */
function formattingMarksOf(marks: readonly Mark[]): InlineMark[] {
  return marks.filter((mark) => !isTrackedMark(mark.type.name) && !isMarkRemoved(mark)).map(describeInlineMark);
}

/**
 * The block's text for an agent's context, with suggestions shown:
 * `<del author="Bob">quick </del><ins author="Bob">agile </ins>`. A line break
 * reads as a newline; other inline leaves have no text.
 */
function decorate(node: PMNode, schema: Schema): string {
  const insertType = schema.marks.trackedInsert;
  const deleteType = schema.marks.trackedDelete;
  const parts: string[] = [];
  node.forEach((child) => {
    const isBreak = breakOf(child.type) === "line";
    if (!child.isText && !isBreak) return;
    const text = escapeXml(child.isText ? child.text ?? "" : "\n");
    const records = child.isText
      ? child.marks.filter((m) => m.type === insertType || m.type === deleteType).flatMap(markRecords)
      : getBlockInlineTrackedData(child) ?? [];
    // Struck text reads as deleted even when it was someone's insertion.
    const pendingAs = (operation: CHANGE_OPERATION) =>
      records.find((record) => record.status === CHANGE_STATUS.pending && record.operation === operation);
    const pending = pendingAs(CHANGE_OPERATION.delete) ?? pendingAs(CHANGE_OPERATION.insert);
    if (!pending) {
      parts.push(text);
      return;
    }
    const tag = pending.operation === CHANGE_OPERATION.delete ? "del" : "ins";
    const author = pending.authorID ? ` author="${escapeAttr(pending.authorID)}"` : "";
    parts.push(`<${tag}${author}>${text}</${tag}>`);
  });
  return parts.join("");
}

/**
 * Whether the accepted text in `[from, to)` is a plain run a replacement may
 * take in. Taking it in deletes and re-inserts it, so it must be what a
 * re-insert can restore: characters side by side in the document, with no
 * break, inline object or newline between them, and no mark — neither
 * formatting a plain insertion would drop nor a suggestion of its own.
 */
export function bridgeable(doc: PMNode, map: readonly PosMapEntry[], from: number, to: number): boolean {
  const lo = Math.max(0, from - 1);
  const hi = Math.min(map.length - 1, to);
  for (let k = lo; k < hi; k++) {
    const here = map[k];
    const next = map[k + 1];
    if (!here || !next || next.docPos !== here.docPos + 1) return false;
  }
  for (let k = from; k < to; k++) {
    const entry = map[k];
    const node = entry && doc.nodeAt(entry.docPos);
    if (!entry || !node?.isText || node.marks.length > 0) return false;
    if (doc.textBetween(entry.docPos, entry.docPos + 1) === "\n") return false;
  }
  return true;
}

/**
 * Convert a 0-based offset in acceptedText to the absolute ProseMirror doc
 * position of that character.
 *
 * Returns `null` if the offset is out of range.
 */
export function acceptedOffsetToDocPos(
  map: readonly PosMapEntry[],
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
  map: readonly PosMapEntry[],
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
  map: readonly PosMapEntry[],
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
