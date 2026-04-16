/**
 * showHideApply.ts
 *
 * Commands for showing, hiding, applying, and rejecting AI suggestions.
 *
 * The "apply" path walks each block's ops and commits them to the document
 * as tracked changes (mode: "tracked") or direct mutations (mode: "direct").
 *
 * The "reject" path removes all pending AI insert marks and restores all
 * AI-deleted text back to plain text in the affected blocks.
 */

import type { IEditor } from "@scrivr/core";
import { findNodeById } from "../ai-toolkit/UniqueId";
import type { AiSuggestion, AiSuggestionBlock, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "./types";
import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
} from "./AiSuggestionPlugin";
import { buildAcceptedTextMap } from "../track-changes/lib/acceptedTextMap";
import { skipTracking, TrackChangesAction, setAction } from "../track-changes/actions";
import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
} from "../track-changes/helpers";
import { applyTrackedDelete } from "../track-changes/lib/splitRangeForNewMark";
import { acceptedRangeToDocRange } from "../track-changes/lib/acceptedTextMap";

/**
 * Set the active AI suggestion. Dispatches AI_SUGGESTION_SET meta.
 * Pass null to clear the current suggestion.
 */
export function showAiSuggestion(editor: IEditor, suggestion: AiSuggestion | null): void {
  const state = editor.getState();
  editor._applyTransaction(
    state.tr
      .setMeta(AI_SUGGESTION_SET, { payload: suggestion })
      .setMeta("addToHistory", false),
  );
}

/**
 * Apply the current AI suggestion to the document.
 *
 * mode "direct"  — writes the proposed text directly into the document.
 * mode "tracked" — records changes as tracked insert/delete marks.
 *
 * If `blockId` is provided, only that block's ops are applied.
 * If `groupId` is provided, only ops matching that groupId are applied.
 */
export function applyAiSuggestion(
  editor: IEditor,
  { groupId, blockId, mode }: ApplyAiSuggestionOptions,
): void {
  const state = editor.getState();
  const ps    = aiSuggestionPluginKey.getState(state);
  if (!ps?.suggestion) return;

  let affectedBlocks = ps.suggestion.blocks;
  if (blockId) {
    affectedBlocks = affectedBlocks.filter((b) => b.nodeId === blockId);
  }

  if (mode === "direct") {
    _applyDirect(editor, affectedBlocks, groupId);
  } else {
    _applyTracked(editor, affectedBlocks, groupId);
  }

  // Remove accepted block(s) from the suggestion; clear when none remain
  if (!groupId) {
    const remaining = blockId
      ? ps.suggestion.blocks.filter((b) => b.nodeId !== blockId)
      : [];
    showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
  }
}

/** Apply by directly writing the proposed text into the doc (no tracking marks). */
function _applyDirect(
  editor: IEditor,
  blocks: AiSuggestionBlock[],
  groupId?: string,
): void {
  const state  = editor.getState();
  const schema = state.schema;

  // Process blocks in reverse document order to keep positions stable
  const resolved = blocks.flatMap((b) => {
    const found = findNodeById(state.doc, b.nodeId);
    return found ? [{ block: b, found }] : [];
  });
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    let acceptedOffset = 0;
    let insertedChars  = 0;

    for (const op of block.ops) {
      const tokenLen = op.text.length;

      if (op.type === "keep") {
        acceptedOffset += tokenLen;
        continue;
      }

      if (groupId && op.groupId !== groupId) {
        if (op.type === "delete") acceptedOffset += tokenLen;
        continue;
      }

      if (op.type === "delete") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
        if (range) {
          tr.delete(range.from + insertedChars, range.to + insertedChars);
          insertedChars -= tokenLen;
        }
        acceptedOffset += tokenLen;
      } else if (op.type === "insert") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
        if (range) {
          const textNode = schema.text(op.text);
          tr.insert(range.from + insertedChars, textNode);
          insertedChars += op.text.length;
        }
        // acceptedOffset does NOT advance for inserts
      }
    }
  }

  skipTracking(tr);
  editor._applyTransaction(tr);
}

/** Apply by recording changes as tracked insert/delete marks. */
function _applyTracked(
  editor: IEditor,
  blocks: AiSuggestionBlock[],
  groupId?: string,
): void {
  const state    = editor.getState();
  const schema   = state.schema;
  const authorID = "ai:assistant";
  const now      = Date.now();

  const resolved = blocks.flatMap((b) => {
    const found = findNodeById(state.doc, b.nodeId);
    return found ? [{ block: b, found }] : [];
  });
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    let acceptedOffset = 0;
    let insertedChars  = 0;

    for (const op of block.ops) {
      const tokenLen = op.text.length;

      if (op.type === "keep") {
        acceptedOffset += tokenLen;
        continue;
      }

      if (groupId && op.groupId !== groupId) {
        if (op.type === "delete") acceptedOffset += tokenLen;
        continue;
      }

      const baseAttrs = createNewPendingAttrs(now, authorID);

      if (op.type === "delete") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
        if (range) {
          const dataTracked = addTrackIdIfDoesntExist(createNewDeleteAttrs(baseAttrs)) as Record<string, unknown>;
          if (op.groupId) dataTracked["groupId"] = op.groupId;
          applyTrackedDelete(tr, range.from + insertedChars, range.to + insertedChars, dataTracked, schema);
        }
        acceptedOffset += tokenLen;
      } else if (op.type === "insert") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
        if (range) {
          const insertMarkType = schema.marks.trackedInsert;
          if (insertMarkType) {
            const dataTracked = addTrackIdIfDoesntExist(createNewInsertAttrs(baseAttrs)) as Record<string, unknown>;
            if (op.groupId) dataTracked["groupId"] = op.groupId;
            const safeText = op.text.replace(/\n/g, " ");
            tr.insert(range.from + insertedChars, schema.text(safeText, [insertMarkType.create({ dataTracked })]));
            insertedChars += safeText.length;
          }
        }
        // acceptedOffset does NOT advance for inserts
      }
    }
  }

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  editor._applyTransaction(tr);
}

/**
 * Reject the current AI suggestion.
 *
 * Removes all trackedInsert marks applied by the suggestion and removes
 * trackedDelete marks (restoring the original text).
 *
 * If `blockId` is provided, only that block's ops are reversed.
 * If `groupId` is provided, only ops matching that groupId are reversed.
 */
export function rejectAiSuggestion(
  editor: IEditor,
  options?: RejectAiSuggestionOptions,
): void {
  const state = editor.getState();
  const ps    = aiSuggestionPluginKey.getState(state);
  if (!ps?.suggestion) return;

  const { blockId, groupId } = options ?? {};

  let affectedBlocks = ps.suggestion.blocks;
  if (blockId) {
    affectedBlocks = affectedBlocks.filter((b) => b.nodeId === blockId);
  }

  const schema   = state.schema;
  const resolved = affectedBlocks.flatMap((b) => {
    const found = findNodeById(state.doc, b.nodeId);
    return found ? [{ block: b, found }] : [];
  });
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    let acceptedOffset = 0;
    let insertedChars  = 0;

    for (const op of block.ops) {
      const tokenLen = op.text.length;

      if (op.type === "keep") {
        acceptedOffset += tokenLen;
        continue;
      }

      if (groupId && op.groupId !== groupId) {
        if (op.type === "delete") acceptedOffset += tokenLen;
        continue;
      }

      if (op.type === "delete") {
        // Rejecting a delete = restore the text. The trackedDelete mark
        // needs to be removed so the text reappears as normal.
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
        if (range) {
          const deleteMarkType = schema.marks.trackedDelete;
          if (deleteMarkType) {
            tr.removeMark(range.from + insertedChars, range.to + insertedChars, deleteMarkType);
          }
        }
        acceptedOffset += tokenLen;
      } else if (op.type === "insert") {
        // Rejecting an insert = remove the trackedInsert text written by
        // applyAiSuggestion(tracked). Guard: only delete if a trackedInsert
        // mark is actually present at this position — if the suggestion was
        // never applied (fresh rejection), there is no inserted text to remove
        // and deleting would mangle the original document content.
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
        if (range) {
          const fromPos = range.from + insertedChars;
          const insertMarkType = schema.marks.trackedInsert;
          const nodeAfter = insertMarkType
            ? state.doc.resolve(fromPos).nodeAfter
            : null;
          if (nodeAfter && nodeAfter.marks.some((m) => m.type === insertMarkType)) {
            const insertLen = Math.min(op.text.length, nodeAfter.nodeSize);
            tr.delete(fromPos, fromPos + insertLen);
            insertedChars -= insertLen;
          }
        }
        // acceptedOffset does NOT advance for inserts
      }
    }
  }

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  editor._applyTransaction(tr);

  // Remove rejected block(s) from the suggestion; clear when none remain
  if (!groupId) {
    const remaining = blockId
      ? ps.suggestion.blocks.filter((b) => b.nodeId !== blockId)
      : [];
    showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
  }
}
