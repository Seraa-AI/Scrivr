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
import { subscribeViewUpdates, subscribeEditorFocusOutside, isAnchorInsideContainer } from "@scrivr/core";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap, acceptedRangeToDocRange } from "@scrivr/plugins";
import { aiSuggestionPluginKey } from "./AiSuggestionPlugin";
import { buildGroupRanges, type GroupRange } from "./groupRanges";
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
  /**
   * Set when the group proposes formatting rather than wording — the run whose
   * appearance changes, with its words unchanged. A UI that renders
   * `replacedText → insertedText` has nothing to show for one of these and
   * should describe the formatting instead.
   */
  formattedText?: string;
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
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Used by the focus-outside check so clicks INTO the popover (e.g. Accept
   * / Reject buttons) don't trigger an immediate hide.
   */
  getPopoverElement?: () => HTMLElement | null;
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
  const { onShow, onMove, onHide, getPopoverElement } = callbacks;
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
    let found: (GroupRange & { groupId: string; isStale: boolean }) | null = null;

    outer: for (const block of suggestion.blocks) {
      const nodeFound = findNodeById(state.doc, block.nodeId);
      if (!nodeFound) continue;

      const { map } = buildAcceptedTextMap(nodeFound.node, nodeFound.pos, schema);
      const isStale = pluginState.staleBlockIds.has(block.nodeId);

      const blockStart = nodeFound.pos;
      const blockEnd   = nodeFound.pos + nodeFound.node.nodeSize;
      if (head < blockStart || head > blockEnd) continue;

      const groupRanges = buildGroupRanges(block.ops, map);
      if (groupRanges.size === 0) continue;

      let bestGroupId: string | null = null;
      let bestRange: GroupRange | null = null;
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
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const info: SuggestionGroupInfo = {
      groupId:      found.groupId,
      replacedText: found.replacedText,
      insertedText: found.insertedText,
      ...(found.formattedText !== undefined ? { formattedText: found.formattedText } : {}),
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

  // subscribe() covers doc/selection changes; subscribeViewUpdates also
  // catches scroll / resize so the popover follows its anchor.
  const offState = editor.subscribe(update);
  const offView = subscribeViewUpdates(editor, update);
  // Editor blur (click outside the editor entirely) doesn't change state,
  // so the two subscriptions above miss it. Forces hide unless focus moved
  // into the popover's own DOM.
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      if (visible) { visible = false; lastKey = null; onHide(); }
    },
    getPopoverElement ? { getPopoverElement } : {},
  );

  return () => {
    offState();
    offView();
    offFocusOutside();
    if (visible) { visible = false; lastKey = null; onHide(); }
  };
}
