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

import type { IBaseEditor } from "@scrivr/core";
import { resolveInlineMark, spansToFragment } from "@scrivr/core";
import type { InlineMark } from "@scrivr/core";
import { Fragment } from "@scrivr/core/pm";
import type { Mark, Node as PmNode, Schema, Transaction } from "@scrivr/core/pm";
import { findNodeById } from "../ai-toolkit/UniqueId";
import type { AiOp, AiSuggestion, AiSuggestionBlock, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "./types";
import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
} from "./AiSuggestionPlugin";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { isTrackedMark, skipTracking, TrackChangesAction, setAction } from "@scrivr/plugins";
import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
} from "@scrivr/plugins";
import { applyTrackedDelete } from "@scrivr/plugins";
import { acceptedRangeToDocRange } from "@scrivr/plugins";

/**
 * Set the active AI suggestion. Dispatches AI_SUGGESTION_SET meta.
 * Pass null to clear the current suggestion.
 */
export function showAiSuggestion(editor: IBaseEditor, suggestion: AiSuggestion | null): void {
  const state = editor.getState();
  editor.applyTransaction(
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
  editor: IBaseEditor,
  { groupId, blockId, mode }: ApplyAiSuggestionOptions,
): void {
  const state = editor.getState();
  const ps    = aiSuggestionPluginKey.getState(state);
  if (!ps?.suggestion) return;

  let affectedBlocks = ps.suggestion.blocks;
  if (blockId) {
    affectedBlocks = affectedBlocks.filter((b) => b.nodeId === blockId);
  }

  applyKeepFormatting(editor, affectedBlocks, groupId, mode !== "direct");

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

/**
 * Make the run at [from, to) read the way `marks` says — adding what the
 * proposal asks for and removing the formatting it drops. Tracked-change marks
 * are left alone: they describe the review state of the text, not how it reads.
 *
 * A proposal whose wording is unchanged lives entirely on `keep` ops, so this is
 * the only thing that applies it.
 */
function applyRunMarks(
  tr: Transaction,
  schema: Schema,
  from: number,
  to: number,
  marks: readonly InlineMark[],
): void {
  if (to <= from) return;

  // Agent-supplied marks go through the same seam as inserted text: an unsafe
  // url or an unbuildable mark is dropped rather than written. Retained text is
  // not a softer target than inserted text.
  const resolved = new Map<string, Mark>();
  for (const mark of marks) {
    const real = resolveInlineMark(mark, schema);
    if (real) resolved.set(real.type.name, real);
  }

  for (const markType of Object.values(schema.marks)) {
    if (isTrackedMark(markType.name)) continue;
    if (!resolved.has(markType.name)) tr.removeMark(from, to, markType);
  }
  for (const mark of resolved.values()) tr.addMark(from, to, mark);
}

/**
 * Apply the formatting a proposal asks for on the text it keeps.
 *
 * Its own transaction, before any text moves, so every range resolves against
 * the document the suggestion was computed from. Tracked mode dispatches it
 * *unskipped* — a formatting change has its own tracked representation, and the
 * engine produces it from an ordinary mark step, so a reviewer can reject the
 * formatting exactly as they reject the words. Direct mode skips tracking,
 * which is what direct means.
 *
 * Accepting one replacement group applies no formatting at all: a keep's marks
 * describe the whole block, and `applyRunMarks` removes what the proposal
 * omits, so running it for a single group would strip the reader's own
 * formatting from text that group never spoke about.
 */
function applyKeepFormatting(
  editor: IBaseEditor,
  blocks: AiSuggestionBlock[],
  groupId: string | undefined,
  tracked: boolean,
): void {
  if (groupId) return;

  const state = editor.getState();
  const schema = state.schema;
  const resolved = blocks.flatMap((block) => {
    const found = findNodeById(state.doc, block.nodeId);
    return found ? [{ block, found }] : [];
  });
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;
  let touched = false;
  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);
    let acceptedOffset = 0;
    for (const op of block.ops) {
      if (op.type === "insert") continue;
      if (op.type === "keep" && op.marks) {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + op.text.length);
        if (range) {
          applyRunMarks(tr, schema, range.from, range.to, op.marks);
          touched = true;
        }
      }
      acceptedOffset += op.text.length;
    }
  }

  if (!touched) return;
  if (!tracked) skipTracking(tr);
  editor.applyTransaction(tr);
}

/**
 * The content an insert op puts in the document — its text, carrying whatever
 * formatting the op proposed. An op made from plain text proposes none, which
 * `spansToFragment` renders as an unmarked run.
 */
function insertedContent(op: AiOp, schema: Schema, extraMarks: readonly Mark[] = []) {
  const fragment = spansToFragment([{ text: op.text, marks: op.marks ?? [] }], schema);
  if (extraMarks.length === 0) return fragment;
  const marked: PmNode[] = [];
  fragment.forEach((child) => {
    marked.push(extraMarks.reduce((node, mark) => node.mark(mark.addToSet(node.marks)), child));
  });
  return Fragment.fromArray(marked);
}

/** Apply by directly writing the proposed text into the doc (no tracking marks). */
function _applyDirect(
  editor: IBaseEditor,
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
          const content = insertedContent(op, schema);
          tr.insert(range.from + insertedChars, content);
          insertedChars += content.size;
        }
        // acceptedOffset does NOT advance for inserts
      }
    }
  }

  skipTracking(tr);
  editor.applyTransaction(tr);
}

/** Apply by recording changes as tracked insert/delete marks. */
function _applyTracked(
  editor: IBaseEditor,
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
            const content = insertedContent({ ...op, text: safeText }, schema, [
              insertMarkType.create({ dataTracked }),
            ]);
            tr.insert(range.from + insertedChars, content);
            insertedChars += content.size;
          }
        }
        // acceptedOffset does NOT advance for inserts
      }
    }
  }

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  editor.applyTransaction(tr);
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
  editor: IBaseEditor,
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
  editor.applyTransaction(tr);

  // Remove rejected block(s) from the suggestion; clear when none remain
  if (!groupId) {
    const remaining = blockId
      ? ps.suggestion.blocks.filter((b) => b.nodeId !== blockId)
      : [];
    showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
  }
}
