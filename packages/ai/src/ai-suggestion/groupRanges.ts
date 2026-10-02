/**
 * Where each group of a suggestion sits in the document, and what it proposes
 * there.
 *
 * Separate from the popover that consumes it because it is the part with rules:
 * a replacement spans the text it removes, a pure insertion has no span and
 * anchors at a point, and a formatting group covers text that is staying and so
 * has neither replaced nor inserted text to describe it.
 */
import { acceptedRangeToDocRange, type buildAcceptedTextMap } from "@scrivr/plugins";

import { withAcceptedOffsets } from "./groupSpans";

import type { AiOp } from "./types";

/**
 * Where a group sits in the document and what it proposes there. One shape,
 * because the popover threads it through several steps and a field added to
 * only some of them compiles.
 */
export interface GroupRange {
  from: number;
  to: number;
  replacedText: string;
  insertedText: string;
  /**
   * Set when the group proposes formatting rather than wording — the run whose
   * appearance changes, with its words unchanged. A UI rendering
   * `replacedText → insertedText` has nothing to show for one of these and
   * should describe the formatting instead.
   */
  formattedText?: string;
}

/**
 * Walk a block's ops and collect from/to doc positions for each unique groupId.
 * Returns a map of groupId → { from, to } covering all ops in that group.
 */
export function buildGroupRanges(
  ops: AiOp[],
  map: ReturnType<typeof buildAcceptedTextMap>["map"],
): Map<string, GroupRange> {
  const groups = new Map<string, {
    deleteFrom: number; deleteTo: number; deleteText: string;
    insertText: string;
    hasInsert: boolean;
    insertAnchor: number | null;
  }>();

  const formatted = new Map<string, { from: number; to: number; formattedText: string }>();

  // Offsets come from `withAcceptedOffsets`, so which ops consume accepted
  // text is stated once rather than re-derived in each branch below.
  for (const { op, offset: acceptedOffset } of withAcceptedOffsets(ops)) {
    if (op.type === "keep") {
      // A keep carrying marks is a formatting proposal on text that stays. It
      // has a group of its own so a reader can accept it, and it anchors over
      // the run itself — there is no replaced or inserted text to point at.
      if (op.marks && op.groupId) {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + op.text.length);
        if (range) {
          formatted.set(op.groupId, { from: range.from, to: range.to, formattedText: op.text });
        }
      }
      continue;
    }

    const groupId = op.groupId;
    if (!groupId) continue;

    if (!groups.has(groupId)) {
      groups.set(groupId, {
        deleteFrom: Infinity, deleteTo: -Infinity,
        deleteText: "", insertText: "", hasInsert: false, insertAnchor: null,
      });
    }
    const g = groups.get(groupId)!;

    if (op.type === "delete") {
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + op.text.length);
      if (range) {
        g.deleteFrom = Math.min(g.deleteFrom, range.from);
        g.deleteTo   = Math.max(g.deleteTo,   range.to);
      }
      g.deleteText += op.text;
    } else {
      // insert — anchor at current acceptedOffset
      if (!g.hasInsert) {
        const anchor = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
        g.insertAnchor = anchor?.from ?? null;
      }
      g.insertText += op.text;
      g.hasInsert = true;
    }
  }

  const result = new Map<string, GroupRange>();

  for (const [groupId, fmt] of formatted) {
    result.set(groupId, {
      from: fmt.from,
      to: fmt.to,
      replacedText: "",
      insertedText: "",
      formattedText: fmt.formattedText,
    });
  }

  for (const [groupId, g] of groups) {
    let from: number;
    let to: number;
    if (g.deleteFrom !== Infinity) {
      from = g.deleteFrom;
      to   = g.deleteTo === -Infinity ? from : g.deleteTo;
    } else {
      // Pure insert — use the anchor doc position
      from = g.insertAnchor ?? 0;
      to   = from;
    }
    result.set(groupId, {
      from,
      to,
      replacedText: g.deleteText,
      insertedText: g.insertText,
    });
  }

  return result;
}
