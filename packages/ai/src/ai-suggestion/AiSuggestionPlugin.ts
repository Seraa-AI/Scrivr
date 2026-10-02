/**
 * AiSuggestionPlugin.ts
 *
 * ProseMirror plugin that holds the AiSuggestionPluginState:
 *   - suggestion:    the active AiSuggestion (null when none)
 *   - staleBlockIds: nodeIds whose accepted text has changed since the
 *     proposal was computed. Recomputed here whenever the answer can change —
 *     a new or settled suggestion, or an edit to the document — so every
 *     reader gets it for the cost of a set lookup instead of walking the
 *     document per block per paint.
 *   - hoverBlockId:  nodeId currently hovered in a React edge card
 *   - activeBlockId: nodeId containing the cursor
 *
 * Meta action keys:
 *   AI_SUGGESTION_SET          — payload: AiSuggestion | null
 *   AI_SUGGESTION_SET_STALE    — payload: ReadonlySet<string>
 *   AI_SUGGESTION_SET_HOVER    — payload: string | null
 *   AI_SUGGESTION_SET_ACTIVE   — payload: string | null
 */

import { Plugin, PluginKey } from "@scrivr/core/pm";
import type { EditorState, Transaction } from "@scrivr/core/pm";
import { driftedBlocks } from "./drift";
import type { AiSuggestionPluginState } from "./types";

export const aiSuggestionPluginKey = new PluginKey<AiSuggestionPluginState>("aiSuggestion");

export const AI_SUGGESTION_SET        = "aiSuggestion:set";
export const AI_SUGGESTION_SET_STALE  = "aiSuggestion:setStale";
export const AI_SUGGESTION_SET_HOVER  = "aiSuggestion:setHover";
export const AI_SUGGESTION_SET_ACTIVE = "aiSuggestion:setActive";
/**
 * One group of the current suggestion has been settled.
 *
 * Distinct from `AI_SUGGESTION_SET`, which means "a different suggestion
 * arrived" and resets what the reader was looking at. Settling a group is the
 * reader acting *within* the suggestion they are already reading — clearing the
 * active block there blanks the overlay for everything else in it, and nothing
 * restores it until the caret moves, which accepting formatting does not do.
 */
export const AI_SUGGESTION_SETTLE    = "aiSuggestion:settle";

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

const EMPTY_STATE: AiSuggestionPluginState = {
  suggestion:    null,
  staleBlockIds: new Set(),
  hoverBlockId:  null,
  activeBlockId: null,
};

export const aiSuggestionPlugin = new Plugin<AiSuggestionPluginState>({
  key: aiSuggestionPluginKey,

  state: {
    init: () => ({ ...EMPTY_STATE }),

    apply(
      tr: Transaction,
      prev: AiSuggestionPluginState,
      _oldState: EditorState,
      newState: EditorState,
    ) {
      // Handle AI_SUGGESTION_SET
      const newSuggestion = tr.getMeta(AI_SUGGESTION_SET) as
        | { payload: AiSuggestionPluginState["suggestion"] }
        | undefined;
      if (newSuggestion !== undefined) {
        // Computed, not assumed empty: a host can hand us a proposal that was
        // already out of date when it arrived.
        return {
          ...prev,
          suggestion:    newSuggestion.payload,
          staleBlockIds: driftedBlocks(newState, newSuggestion.payload),
          hoverBlockId:  null,
          activeBlockId: null,
        };
      }

      // Handle AI_SUGGESTION_SETTLE — the suggestion changes, the view does not.
      const settled = tr.getMeta(AI_SUGGESTION_SETTLE) as
        | { value: AiSuggestionPluginState["suggestion"] }
        | undefined;
      if (settled !== undefined) {
        // The rebase refreshed each surviving block's `acceptedText` against
        // the document the settlement left, so what was stale a moment ago
        // need not be.
        return {
          ...prev,
          suggestion: settled.value,
          staleBlockIds: driftedBlocks(newState, settled.value),
        };
      }

      // Handle AI_SUGGESTION_SET_STALE
      const newStale = tr.getMeta(AI_SUGGESTION_SET_STALE) as
        | ReadonlySet<string>
        | undefined;
      if (newStale !== undefined) {
        return { ...prev, staleBlockIds: newStale };
      }

      // Handle AI_SUGGESTION_SET_HOVER
      const hoverMeta = tr.getMeta(AI_SUGGESTION_SET_HOVER);
      if (hoverMeta !== undefined) {
        return { ...prev, hoverBlockId: (hoverMeta as string | null) };
      }

      // Handle AI_SUGGESTION_SET_ACTIVE
      const activeMeta = tr.getMeta(AI_SUGGESTION_SET_ACTIVE);
      if (activeMeta !== undefined) {
        return { ...prev, activeBlockId: (activeMeta as string | null) };
      }

      // An edit to the document is the other way the answer changes. Checked
      // last so an explicit payload above wins.
      if (tr.docChanged && prev.suggestion) {
        const stale = driftedBlocks(newState, prev.suggestion);
        // Only a different answer produces new state. Returning a fresh Set on
        // every keystroke would change plugin-state identity, and the card
        // subscription skips re-rendering on that identity.
        if (sameIds(stale, prev.staleBlockIds)) return prev;
        return { ...prev, staleBlockIds: stale };
      }

      return prev;
    },
  },
});
