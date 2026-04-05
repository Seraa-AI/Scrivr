/**
 * AiSuggestionPlugin.ts
 *
 * ProseMirror plugin that holds the AiSuggestionPluginState:
 *   - suggestion:    the active AiSuggestion (null when none)
 *   - staleBlockIds: nodeIds whose accepted text has changed since suggestion applied
 *   - hoverBlockId:  nodeId currently hovered in a React edge card
 *   - activeBlockId: nodeId containing the cursor
 *
 * Meta action keys:
 *   AI_SUGGESTION_SET          — payload: AiSuggestion | null
 *   AI_SUGGESTION_SET_STALE    — payload: ReadonlySet<string>
 *   AI_SUGGESTION_SET_HOVER    — payload: string | null
 *   AI_SUGGESTION_SET_ACTIVE   — payload: string | null
 */

import { Plugin, PluginKey } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { AiSuggestionPluginState } from "./types";

export const aiSuggestionPluginKey = new PluginKey<AiSuggestionPluginState>("aiSuggestion");

export const AI_SUGGESTION_SET        = "aiSuggestion:set";
export const AI_SUGGESTION_SET_STALE  = "aiSuggestion:setStale";
export const AI_SUGGESTION_SET_HOVER  = "aiSuggestion:setHover";
export const AI_SUGGESTION_SET_ACTIVE = "aiSuggestion:setActive";

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

    apply(tr: Transaction, prev: AiSuggestionPluginState) {
      // Handle AI_SUGGESTION_SET
      const newSuggestion = tr.getMeta(AI_SUGGESTION_SET) as
        | { payload: AiSuggestionPluginState["suggestion"] }
        | undefined;
      if (newSuggestion !== undefined) {
        return {
          ...prev,
          suggestion:    newSuggestion.payload,
          staleBlockIds: new Set<string>(),
          hoverBlockId:  null,
          activeBlockId: null,
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

      return prev;
    },
  },
});
