/**
 * createSuggestionPopover.ts
 *
 * Headless controller for the AI suggestion popover.
 *
 * Subscribes to editor state changes and fires onShow/onMove/onHide whenever
 * the cursor lands inside an AI suggestion op's range.
 *
 * Follows the same subscriber pattern as createChangePopover. The React layer
 * (AiSuggestionPopover) is a thin wrapper around this.
 */

import type { IEditor } from "@scrivr/core";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap, acceptedRangeToDocRange } from "../track-changes/lib/acceptedTextMap";
import { aiSuggestionPluginKey } from "./AiSuggestionPlugin";
import type { AiSuggestion, AiOp } from "./types";

/**
 * Information about a suggestion group.
 */
export interface SuggestionGroupInfo {
  /** Shared groupId for all ops in this logical replacement. */
  groupId: string;
  /** The text being replaced/removed. Empty string for pure insertions. */
  replacedText: string;
  /** The replacement text being proposed. Empty string for pure deletions. */
  insertedText: string;
  /** The suggestion this group belongs to (for apply/reject calls). */
  suggestion: AiSuggestion;
  /** Whether this block's acceptedText has drifted from the live document. */
  isStale: boolean;
}

/**
 * Callback functions for the suggestion popover.
 */
export interface SuggestionPopoverCallbacks {
  onShow: (rect: DOMRect, info: SuggestionGroupInfo) => void;
  onMove: (rect: DOMRect, info: SuggestionGroupInfo) => void;
  onHide: () => void;
}

/**
 * Walk a block's ops and collect from/to doc positions for each unique groupId.
 * Returns a map of groupId → { from, to } covering all ops in that group.
 */
function buildGroupRanges(
  ops: AiOp[],
  map: ReturnType<typeof buildAcceptedTextMap>["map"],
): Map<string, { from: number; to: number; replacedText: string; insertedText: string }> {
  const groups = new Map<string, {
    deleteFrom: number; deleteTo: number; deleteText: string;
    insertText: string;
    hasInsert: boolean;
    insertAnchor: number | null;
  }>();

  let acceptedOffset = 0;

  for (const op of ops) {
    if (op.type === "keep") {
      acceptedOffset += op.text.length;
      continue;
    }

    const groupId = op.groupId;
    if (!groupId) {
      if (op.type === "delete") acceptedOffset += op.text.length;
      continue;
    }

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
      acceptedOffset += op.text.length;
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

  const result = new Map<string, { from: number; to: number; replacedText: string; insertedText: string }>();

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

/**
 * Create a headless AI suggestion popover controller.
 *
 * @returns A cleanup function — call it when the component unmounts.
 *
 * @example
 * const cleanup = createSuggestionPopover(editor, {
 *   onShow: (rect, info) => setPopover({ rect, info }),
 *   onMove: (rect, info) => setPopover({ rect, info }),
 *   onHide: ()           => setPopover(null),
 * });
 * // later:
 * cleanup();
 */
export function createSuggestionPopover(
  editor: IEditor,
  callbacks: SuggestionPopoverCallbacks,
): () => void {
  const { onShow, onMove, onHide } = callbacks;
  let visible  = false;
  let lastKey: string | null = null;

  function update() {
    const state       = editor.getState();
    const pluginState = aiSuggestionPluginKey.getState(state);

    if (!pluginState?.suggestion) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const { suggestion } = pluginState;
    const { head } = state.selection;
    const schema = state.schema;

    // Find the first group whose doc range contains the cursor.
    let found: { groupId: string; from: number; to: number; replacedText: string; insertedText: string; isStale: boolean } | null = null;

    outer: for (const block of suggestion.blocks) {
      const nodeFound = findNodeById(state.doc, block.nodeId);
      if (!nodeFound) continue;

      const { acceptedText: liveText, map } = buildAcceptedTextMap(
        nodeFound.node, nodeFound.pos, schema,
      );
      const isStale = liveText !== block.acceptedText;

      const blockStart = nodeFound.pos;
      const blockEnd   = nodeFound.pos + nodeFound.node.nodeSize;
      if (head < blockStart || head > blockEnd) continue;

      const groupRanges = buildGroupRanges(block.ops, map);
      if (groupRanges.size === 0) continue;

      let bestGroupId: string | null = null;
      let bestRange: { from: number; to: number; replacedText: string; insertedText: string } | null = null;
      let bestDist = Infinity;

      for (const [gId, range] of groupRanges) {
        if (head >= range.from && head <= range.to) {
          bestGroupId = gId;
          bestRange = range;
          break;
        }
        const dist = range.from === range.to
          ? Math.abs(head - range.from)
          : head < range.from ? range.from - head : head - range.to;
        if (dist < bestDist) {
          bestDist = dist;
          bestGroupId = gId;
          bestRange = range;
        }
      }

      if (bestGroupId && bestRange) {
        found = { groupId: bestGroupId, ...bestRange, isStale };
        break outer;
      }
    }

    if (!found) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const rect = editor.getViewportRect(found.from, found.to);
    if (!rect) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const info: SuggestionGroupInfo = {
      groupId:      found.groupId,
      replacedText: found.replacedText,
      insertedText: found.insertedText,
      suggestion,
      isStale:      found.isStale,
    };

    const key = found.groupId;

    if (visible && lastKey === key) {
      onMove(rect, info);
    } else {
      visible = true;
      lastKey = key;
      onShow(rect, info);
    }
  }

  const unsubscribe = editor.subscribe(update);

  return () => {
    unsubscribe();
    if (visible) { visible = false; lastKey = null; onHide(); }
  };
}
