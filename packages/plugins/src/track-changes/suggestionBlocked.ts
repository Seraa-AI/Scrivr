import type { EditorState, Transaction } from "@scrivr/core/pm";

import { trackAsSuggestion } from "./actions";
import { gestureRefusal, untracked } from "./engine/trackChanges";
import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { TrackChangesStatus, type SuggestionBlock } from "./types";

/**
 * Why `tr`, a suggestion built on `state`, would not be recorded if dispatched,
 * or null when it would be. A suggestion that lands unrecorded is a direct edit
 * of someone's text, and one stopped by the plugin is lost without a word, so a
 * caller writing on someone's behalf asks this first and reports the answer.
 */
export function suggestionBlocked(state: EditorState, tr: Transaction): SuggestionBlock | null {
  const tracking = trackChangesPluginKey.getState(state);
  if (!tracking) return { reason: "no-tracking" };
  if (tracking.status === TrackChangesStatus.viewSnapshots) return { reason: "viewing-snapshots" };
  if (tr.docChanged && untracked(tr, tracking.skipTrsWithMetas)) return { reason: "untracked" };
  return gestureRefusal(tr, state, tracking.skipTrsWithMetas);
}

/**
 * Dispatches `tr` as `authorID`'s suggestion, unless it would not be recorded.
 * Without `dispatch`, only says whether it would be.
 */
export function dispatchSuggestion(
  state: EditorState,
  tr: Transaction,
  authorID: string,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const suggestion = trackAsSuggestion(tr, authorID);
  if (suggestionBlocked(state, suggestion)) return false;
  dispatch?.(suggestion);
  return true;
}
