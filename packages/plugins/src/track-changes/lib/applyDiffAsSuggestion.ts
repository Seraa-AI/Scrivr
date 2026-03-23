/**
 * applyDiffAsSuggestion / applyMultiBlockDiff
 *
 * Turn AI-proposed text replacements into tracked insert/delete marks on the
 * live ProseMirror document.
 *
 * Single-block flow (applyDiffAsSuggestion):
 *   1. Find the block node by its `nodeId` attribute.
 *   2. Build the accepted-text map for that node.
 *   3. Diff acceptedText → proposedText (legal-aware tokeniser).
 *   4. Group replacement pairs (look-ahead buffer, shared groupId).
 *   5. Expand similar word-level replacements to char-level marks.
 *   6. Convert each op's token offset to an absolute doc position.
 *   7. Apply inserts/deletes as tracked marks (conflict-aware).
 *   8. Dispatch the transaction.
 *
 * Multi-block flow (applyMultiBlockDiff):
 *   Same pipeline, but across an array of { nodeId, proposedText } pairs.
 *   Blocks are processed in reverse document order so inserts/deletes in
 *   one block do not shift positions of blocks above it in the same transaction.
 *   All changes land in a single transaction → one undo step.
 *
 * Returns { applied, editDensity }:
 *   applied     — true if at least one op was dispatched
 *   editDensity — fraction of original chars deleted (0–1), weighted by
 *                 source-character count across all blocks.
 *                 Callers can use this as a quality gate:
 *                   < 0.2 → small edit, show fine-grained marks inline
 *                   0.2–0.7 → moderate rewrite, show marks + summary banner
 *                   > 0.7 → full rewrite, offer "Accept rewrite" button
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
import {
  computeEditDensity,
  diffText,
  expandCharLevel,
  pairReplacements,
} from "./diffText";
import { applyTrackedDelete } from "./splitRangeForNewMark";
import { skipTracking, TrackChangesAction, setAction } from "../actions";

// ── Public types ──────────────────────────────────────────────────────────────

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

export interface MultiBlockDiffOptions {
  /** One entry per block to rewrite. Order does not matter — sorted internally. */
  blocks: Array<{ nodeId: string; proposedText: string }>;
  /** Author ID to attribute all suggestions to (e.g. "AI Assistant"). */
  authorID: string;
}

export interface ApplyDiffResult {
  /** true if at least one tracked change was applied and dispatched. */
  applied: boolean;
  /**
   * Fraction of original characters that were deleted (0–1), weighted by
   * source-character count so short paragraphs don't skew the result.
   * 0 = no changes (or pure insertion), 1 = everything deleted.
   */
  editDensity: number;
}

// ── Inner workhorse ───────────────────────────────────────────────────────────

/**
 * Apply one block's diff into an existing transaction.
 *
 * Separated from the public API so both applyDiffAsSuggestion and
 * applyMultiBlockDiff share identical diffing logic without duplicating code.
 *
 * Returns sourceChars (= acceptedText.length) so the caller can compute a
 * character-weighted density across multiple blocks.
 */
function applyBlockToTr(
  state: EditorState,
  tr: Transaction,
  found: ReturnType<typeof findNodeById> & {},
  proposedText: string,
  authorID: string,
): { applied: boolean; editDensity: number; sourceChars: number } {
  const schema = state.schema;
  const { acceptedText, map } = buildAcceptedTextMap(found.node, found.pos, schema);

  if (acceptedText === proposedText) {
    return { applied: false, editDensity: 0, sourceChars: acceptedText.length };
  }

  const rawOps     = diffText(acceptedText, proposedText);
  const editDensity = computeEditDensity(rawOps);
  const ops        = expandCharLevel(pairReplacements(rawOps));

  const now = Date.now();
  let acceptedOffset = 0; // cursor into acceptedText
  let insertedChars  = 0; // net doc offset from insertions made so far in this block
  let applied        = false;

  for (const op of ops) {
    const tokenLen = op.text.length;

    if (op.type === "keep") {
      acceptedOffset += tokenLen;
      continue;
    }

    // Each op gets its own unique id so ChangeSet doesn't deduplicate them.
    const baseAttrs = createNewPendingAttrs(now, authorID);

    if (op.type === "delete") {
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
      if (range) {
        const dataTracked = addTrackIdIfDoesntExist(createNewDeleteAttrs(baseAttrs)) as Record<string, unknown>;
        if (op.groupId) dataTracked["groupId"] = op.groupId;
        applyTrackedDelete(tr, range.from + insertedChars, range.to + insertedChars, dataTracked, schema);
        applied = true;
      }
      acceptedOffset += tokenLen;
    } else {
      // insert — find the doc position corresponding to the current accepted offset
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
      if (range) {
        const insertMarkType = schema.marks.tracked_insert;
        if (insertMarkType) {
          const dataTracked = addTrackIdIfDoesntExist(createNewInsertAttrs(baseAttrs)) as Record<string, unknown>;
          if (op.groupId) dataTracked["groupId"] = op.groupId;
          const safeText = op.text.replace(/\n/g, " ");
          tr.insert(range.from + insertedChars, schema.text(safeText, [insertMarkType.create({ dataTracked })]));
          insertedChars += safeText.length;
          applied = true;
        }
      }
      // acceptedOffset does NOT advance for inserts (they add new chars)
    }
  }

  return { applied, editDensity, sourceChars: acceptedText.length };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply `proposedText` as a tracked suggestion on the block identified by
 * `nodeId`, attributed to `authorID`.
 *
 * @param state     Current editor state (used for schema + doc).
 * @param dispatch  PM dispatch function. Called with the built transaction.
 * @returns         { applied, editDensity }
 */
export function applyDiffAsSuggestion(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { nodeId, proposedText, authorID }: ApplyDiffOptions,
): ApplyDiffResult {
  const found = findNodeById(state.doc, nodeId);
  if (!found) return { applied: false, editDensity: 0 };

  const tr = state.tr;
  const { applied, editDensity } = applyBlockToTr(state, tr, found, proposedText, authorID);

  if (!applied) return { applied: false, editDensity };

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  dispatch(tr);

  return { applied: true, editDensity };
}

/**
 * Apply proposed text for multiple blocks as a single tracked suggestion,
 * attributed to `authorID`.
 *
 * All changes land in one transaction (one undo step). Blocks are processed
 * in reverse document order so inserts in a lower block do not shift the
 * positions of blocks above it that haven't been processed yet.
 *
 * `editDensity` in the result is a character-weighted average across all
 * blocks — short paragraphs don't skew the overall density score.
 *
 * @param state     Current editor state.
 * @param dispatch  PM dispatch function. Called once with the combined transaction.
 * @returns         { applied, editDensity }
 */
export function applyMultiBlockDiff(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { blocks, authorID }: MultiBlockDiffOptions,
): ApplyDiffResult {
  // Resolve nodeIds → drop any blocks whose node is no longer in the doc.
  const resolved = blocks.flatMap(b => {
    const found = findNodeById(state.doc, b.nodeId);
    return found ? [{ found, proposedText: b.proposedText }] : [];
  });

  if (resolved.length === 0) return { applied: false, editDensity: 0 };

  // Reverse doc order — process last block first so upstream positions stay stable.
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;
  const density = { weighted: 0, sourceChars: 0 };
  let anyApplied = false;

  for (const { found, proposedText } of resolved) {
    const result = applyBlockToTr(state, tr, found, proposedText, authorID);
    if (result.applied) anyApplied = true;
    density.weighted    += result.editDensity * result.sourceChars;
    density.sourceChars += result.sourceChars;
  }

  if (!anyApplied) return { applied: false, editDensity: 0 };

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  dispatch(tr);

  const editDensity = density.sourceChars > 0
    ? density.weighted / density.sourceChars
    : 0;

  return { applied: true, editDensity };
}
