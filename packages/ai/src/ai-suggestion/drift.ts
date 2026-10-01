/**
 * Which blocks a proposal no longer describes.
 *
 * A suggestion's ops are offsets into a snapshot of each block's accepted
 * text. Once the reader edits that block the offsets address characters that
 * have moved or gone, and applying them writes the model's words into the
 * middle of whatever is there now — "quick" plus a proposal of "slow" becomes
 * "slowk".
 *
 * One owner for the question, computed when the answer can change and read
 * cheaply everywhere else. It used to be answered in three places: inline in
 * the popover, and from plugin state that nothing ever wrote — which is what
 * the card and the canvas overlay both read, so both were permanently false.
 */
import type { EditorState } from "@scrivr/core/pm";
import { findNodeById } from "@scrivr/core";
import { buildAcceptedTextMap } from "@scrivr/plugins";

import type { AiSuggestion } from "./types";

/**
 * The nodeIds whose live accepted text differs from the text their proposal
 * was computed against.
 *
 * A block that has left the document counts as drifted — there is nothing left
 * to apply its ops to.
 */
export function driftedBlocks(
  state: EditorState,
  suggestion: AiSuggestion | null,
): Set<string> {
  const drifted = new Set<string>();
  if (!suggestion) return drifted;

  for (const block of suggestion.blocks) {
    const found = findNodeById(state.doc, block.nodeId);
    if (!found) {
      drifted.add(block.nodeId);
      continue;
    }
    const { acceptedText } = buildAcceptedTextMap(found.node, found.pos, state.schema);
    if (acceptedText !== block.acceptedText) drifted.add(block.nodeId);
  }

  return drifted;
}
