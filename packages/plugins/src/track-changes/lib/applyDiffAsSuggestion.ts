/**
 * applyDiffAsSuggestion
 *
 * High-level function that turns an AI-proposed text replacement into
 * tracked insert/delete marks on the live ProseMirror document.
 *
 * Flow:
 *   1. Find the block node by its `nodeId` attribute.
 *   2. Build the accepted-text map for that node.
 *   3. Diff acceptedText → proposedText at the word level.
 *   4. Convert each diff op's token offset to an absolute doc position.
 *   5. Apply the resulting inserts/deletes as tracked marks via
 *      splitRangeForNewMark (conflict-aware).
 *   6. Dispatch the transaction.
 *
 * Returns true if the transaction was dispatched (at least one op applied).
 */

import type { EditorState, Transaction } from "prosemirror-state";

import { findNodeById } from "../../ai-toolkit/UniqueId";
import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
} from "../helpers";
import { acceptedRangeToDocRange, buildAcceptedTextMap } from "./acceptedTextMap";
import { diffText } from "./diffText";
import { applyTrackedDelete, applyTrackedInsert } from "./splitRangeForNewMark";
import { skipTracking } from "../actions";
import { TrackChangesAction } from "../actions";
import { setAction } from "../actions";

export interface ApplyDiffOptions {
  /** The stable `nodeId` attribute of the target block node. */
  nodeId: string;
  /**
   * The proposed replacement for the node's accepted-text view.
   * Must be the full text for the node (not a partial substring).
   */
  proposedText: string;
  /** Author ID to attribute the suggestion to (e.g. "AI Assistant"). */
  authorID: string;
}

/**
 * Apply `proposedText` as a tracked suggestion on the block identified by
 * `nodeId`, attributed to `authorID`.
 *
 * @param state     Current editor state (used for schema + doc).
 * @param dispatch  PM dispatch function. Called with the built transaction.
 * @returns         true if any changes were applied and dispatched.
 */
export function applyDiffAsSuggestion(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { nodeId, proposedText, authorID }: ApplyDiffOptions,
): boolean {
  const found = findNodeById(state.doc, nodeId);
  if (!found) return false;

  const { node, pos: nodePos } = found;
  const schema = state.schema;

  const { acceptedText, map } = buildAcceptedTextMap(node, nodePos, schema);

  // Nothing to do if text is identical
  if (acceptedText === proposedText) return false;

  const ops = diffText(acceptedText, proposedText);

  const now = Date.now();
  const baseAttrs = createNewPendingAttrs(now, authorID);
  const insertData = addTrackIdIfDoesntExist(createNewInsertAttrs(baseAttrs)) as Record<string, unknown>;
  const deleteData = addTrackIdIfDoesntExist(createNewDeleteAttrs(baseAttrs)) as Record<string, unknown>;

  const tr = state.tr;
  let acceptedOffset = 0; // cursor into acceptedText
  let insertedChars = 0;  // net offset accumulator from insertions made so far

  for (const op of ops) {
    const tokenLen = op.text.length;

    if (op.type === "keep") {
      acceptedOffset += tokenLen;
    } else if (op.type === "delete") {
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
      if (range) {
        const from = range.from + insertedChars;
        const to   = range.to   + insertedChars;
        applyTrackedDelete(tr, from, to, { ...deleteData }, schema);
      }
      acceptedOffset += tokenLen;
    } else {
      // insert — find the doc position corresponding to the current accepted offset
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
      if (range) {
        const insertPos = range.from + insertedChars;

        const insertMarkType = schema.marks.tracked_insert;
        if (insertMarkType) {
          const insertMark = insertMarkType.create({ dataTracked: { ...insertData } });
          const safeText = op.text.replace(/\n/g, " ");
          const textNode = schema.text(safeText, [insertMark]);
          tr.insert(insertPos, textNode);
          insertedChars += safeText.length;
        }
      }
      // acceptedOffset does NOT advance for inserts (they add new chars)
    }
  }

  if (!tr.docChanged) return false;

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);

  dispatch(tr);
  return true;
}
