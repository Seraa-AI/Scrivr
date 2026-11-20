import type { EditorState, Transaction } from "@scrivr/core/pm";

import { gestureRefusal } from "./engine/trackChanges";
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
  return gestureRefusal(tr, state, []);
}
