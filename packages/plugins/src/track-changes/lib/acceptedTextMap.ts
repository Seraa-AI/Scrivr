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

import type { Node as PMNode, Schema } from "prosemirror-model";

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
