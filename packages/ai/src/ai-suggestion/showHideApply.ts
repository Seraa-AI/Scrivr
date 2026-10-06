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
import { resolveInlineMarks, describeInlineMark, sameMark, spansToFragment } from "@scrivr/core";
import type { InlineMark } from "@scrivr/core";
import { Fragment } from "@scrivr/core/pm";
import type { EditorState, Mark, Node as PmNode, Schema, Transaction } from "@scrivr/core/pm";
import { findNodeById } from "../ai-toolkit/UniqueId";
import { rebaseAfterSettle } from "./rebase";
import { groupsWithin, withAcceptedOffsets, type AcceptedSpan } from "./groupSpans";
import type { AiOp, AiSuggestion, AiSuggestionBlock, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "./types";
import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
  AI_SUGGESTION_SETTLE,
} from "./AiSuggestionPlugin";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { isTrackedMark, skipTracking, trackAsSuggestion, trackChangesPluginKey, TrackChangesAction, setAction } from "@scrivr/plugins";
import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
} from "@scrivr/plugins";
import { applyTrackedDelete } from "@scrivr/plugins";
import { acceptedRangeToDocRange } from "@scrivr/plugins";

/**
 * The blocks still in the document, furthest-first so a write cannot move the
 * position of one not yet written. Getting the order wrong is invisible until
 * two blocks settle in one pass.
 */
function resolveBlocksInReverse(
  state: EditorState,
  blocks: AiSuggestionBlock[],
): Array<{ block: AiSuggestionBlock; found: { node: PmNode; pos: number } }> {
  const resolved = blocks.flatMap((block) => {
    const found = findNodeById(state.doc, block.nodeId);
    return found ? [{ block, found }] : [];
  });
  resolved.sort((a, b) => b.found.pos - a.found.pos);
  return resolved;
}

/**
 * Which groups an apply covers. `undefined` means every one in the blocks it
 * was given — the unscoped accept — and a set means exactly those.
 */
type GroupScope = ReadonlySet<string> | undefined;

/** Is this op's group one the caller asked for? Ungrouped ops ride an unscoped apply. */
function inScope(scope: GroupScope, groupId: string | undefined): boolean {
  if (!scope) return true;
  return groupId !== undefined && scope.has(groupId);
}

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
 * Applying a single `groupId` rebuilds the rest of the suggestion against the
 * resulting document, so an `AiSuggestion` held across the call is superseded —
 * read the current one back from plugin state.
 *
 * mode "direct"  — writes the proposed text directly into the document.
 * mode "tracked" — records changes as tracked insert/delete marks.
 *
 * If `blockId` is provided, only that block's ops are applied.
 * If `groupId` is provided, only ops matching that groupId are applied.
 * If `range` is provided, only the groups it covers are applied.
 *
 * @returns whether the document changed.
 */
export function applyAiSuggestion(
  editor: IBaseEditor,
  { groupId, blockId, range, mode }: ApplyAiSuggestionOptions,
): boolean {
  const state = editor.getState();
  const ps    = aiSuggestionPluginKey.getState(state);
  if (!ps?.suggestion) return false;

  if (range) {
    if (!blockId) {
      throw new Error("applyAiSuggestion: `range` needs a `blockId` to scope to");
    }
    if (groupId) {
      throw new Error(
        "applyAiSuggestion: pass `range` or `groupId`, not both — they name different things to accept",
      );
    }
    return applyRange(editor, blockId, range, mode);
  }

  // A block the reader has edited since the proposal was computed is refused,
  // on every path: its ops are offsets into text that has moved, so applying
  // them writes the model's words into the middle of what is there now. The
  // others in the batch are unaffected — an edit in one block says nothing
  // about the rest.
  const drifted = ps.staleBlockIds;
  const requested = blockId
    ? ps.suggestion.blocks.filter((b) => b.nodeId === blockId)
    : ps.suggestion.blocks;
  const affectedBlocks = requested.filter((b) => !drifted.has(b.nodeId));
  if (affectedBlocks.length === 0) return false;

  // What the document held before, so settling can tell "applied" from
  // "attempted". An accept that wrote nothing — tracked mode without the
  // TrackChanges extension, or a block the reader has since edited out from
  // under the proposal — must leave the group pending rather than retire it:
  // rebasing on the assumption text moved, when it did not, walks the rest of
  // the proposal across characters that are still there.
  const before = editor.getState().doc;

  const scope = groupId ? new Set([groupId]) : undefined;
  applyKeepFormatting(editor, affectedBlocks, scope, mode !== "direct");

  if (mode === "direct") {
    _applyDirect(editor, affectedBlocks, scope);
  } else {
    _applyTracked(editor, affectedBlocks, scope);
  }

  if (groupId) {
    const wrote = editor.getState().doc !== before;
    if (wrote) settleGroups(editor, ps.suggestion, new Set([groupId]), true);
    return wrote;
  }

  // Everything not accepted stays — the blocks this call did not ask for, and
  // the ones it refused. Clearing those too would lose a proposal the reader
  // never settled.
  const accepted = new Set(affectedBlocks.map((b) => b.nodeId));
  const remaining = ps.suggestion.blocks.filter((b) => !accepted.has(b.nodeId));
  showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
  return editor.getState().doc !== before;
}

/**
 * Apply the groups one span of a block's accepted text covers.
 *
 * The span's offsets only mean something relative to the text they were
 * measured against, so the caller states that text and it has to equal what
 * the block holds now. Comparing the document against `block.acceptedText`
 * instead would prove nothing: settling rewrites that field to the live text,
 * so it always matches, and a caller still holding offsets from before an
 * earlier accept would sail through and edit whichever words now sit at those
 * numbers. Refused rather than approximated.
 *
 * Every covered group is applied in one pass and settled as one set. The
 * rebase has to be told the whole set — see `settleGroups`.
 */
function applyRange(
  editor: IBaseEditor,
  blockId: string,
  range: AcceptedSpan,
  mode: ApplyAiSuggestionOptions["mode"],
): boolean {
  const state = editor.getState();
  const suggestion = aiSuggestionPluginKey.getState(state)?.suggestion;
  const block = suggestion?.blocks.find((b) => b.nodeId === blockId);
  if (!suggestion || !block) return false;

  const found = findNodeById(state.doc, blockId);
  if (!found) return false;
  const { acceptedText: liveText } = buildAcceptedTextMap(found.node, found.pos, state.schema);
  // Two questions, both required: does the block still match its proposal, and
  // was the caller's span measured against that same text.
  if (aiSuggestionPluginKey.getState(state)?.staleBlockIds.has(blockId)) return false;
  if (range.acceptedText !== liveText) return false;

  const covered = groupsWithin(block.ops, range, liveText.length);
  if (covered.length === 0) return false;

  const scope = new Set(covered);
  const before = state.doc;
  applyKeepFormatting(editor, [block], scope, mode !== "direct");
  if (mode === "direct") _applyDirect(editor, [block], scope);
  else _applyTracked(editor, [block], scope);

  if (editor.getState().doc === before) return false;

  settleGroups(editor, suggestion, scope, true);
  return true;
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

  // Resolve against each destination textblock, and compare semantic marks so
  // unchanged formatting keeps its existing review records. Inline atoms and
  // text pending deletion are not characters in the accepted-text proposal.
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || node.marks.some((mark) => mark.type.name === "trackedDelete")) return;
    const desired = resolveInlineMarks(marks, schema, parent?.type);
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const current = node.marks.filter((mark) => !isTrackedMark(mark.type.name));
    for (const mark of current) {
      if (!desired.some((next) => sameMark(describeInlineMark(mark), describeInlineMark(next)))) {
        tr.removeMark(start, end, mark);
      }
    }
    for (const mark of desired) {
      if (!current.some((prev) => sameMark(describeInlineMark(prev), describeInlineMark(mark)))) {
        tr.addMark(start, end, mark);
      }
    }
  });
}

/**
 * Record that a set of groups is finished — see `rebaseAfterSettle` for why
 * that means rebuilding the rest of the proposal rather than marking it done.
 *
 * A set, not one group: a span-scoped accept writes every group its span
 * covers in one pass, and the rebase has to be told all of them or it reads
 * the pass's own writes as reader drift.
 *
 * Dispatched as a settle rather than as a new suggestion: the reader is still
 * reading this one, and replacing it wholesale clears the active block and
 * blanks the rest of the overlay until the caret happens to move.
 */
function settleGroups(
  editor: IBaseEditor,
  suggestion: AiSuggestion,
  groupIds: ReadonlySet<string>,
  accepted: boolean,
): void {
  const owner = suggestion.blocks.find((block) =>
    block.ops.some((op) => op.groupId !== undefined && groupIds.has(op.groupId)),
  );
  const next = owner
    ? rebaseAfterSettle(editor, suggestion, owner.nodeId, groupIds, accepted)
    : suggestion;

  const tr = editor.getState().tr;
  tr.setMeta(AI_SUGGESTION_SETTLE, { value: next });
  skipTracking(tr);
  editor.applyTransaction(tr);
}

/**
 * Apply the formatting a proposal asks for on the text it keeps.
 *
 * Its own transaction, before any text moves, so every range resolves against
 * the document the suggestion was computed from. Tracked mode dispatches it
 * with explicit suggestion intent — a formatting change has its own tracked representation, and the
 * engine produces it from an ordinary mark step, so a reviewer can reject the
 * formatting exactly as they reject the words. Direct mode skips tracking,
 * which is what direct means.
 *
 * A formatting keep carries its own `groupId`, so accepting one group applies
 * exactly that run's formatting — `applyRunMarks` removes what the proposal
 * omits, and the run is the only text that group spoke about. Accepting a
 * word-swap group touches no formatting, because it is a different group.
 */
function applyKeepFormatting(
  editor: IBaseEditor,
  blocks: AiSuggestionBlock[],
  scope: GroupScope,
  tracked: boolean,
): void {
  if (tracked && !trackChangesPluginKey.getState(editor.getState())) return;

  const state = editor.getState();
  const schema = state.schema;
  // Mark-only writes shift no positions, so the order is immaterial here — it
  // reads the shared resolve so a future change to either rule reaches this
  // walker too.
  const resolved = resolveBlocksInReverse(state, blocks);

  const tr = state.tr;
  let touched = false;
  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);
    for (const { op, offset: acceptedOffset } of withAcceptedOffsets(block.ops)) {
      if (op.type === "keep" && op.marks && inScope(scope, op.groupId)) {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + op.text.length);
        if (range) {
          applyRunMarks(tr, schema, range.from, range.to, op.marks);
          touched = true;
        }
      }
    }
  }

  if (!touched || !tr.docChanged) return;
  if (tracked) trackAsSuggestion(tr, "ai:assistant");
  else skipTracking(tr);
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
  scope: GroupScope,
): void {
  const state  = editor.getState();
  const schema = state.schema;

  const resolved = resolveBlocksInReverse(state, blocks);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    // How far this walker's own writes have shifted the doc. Not shareable
    // with the other walkers: a tracked delete marks text instead of removing
    // it, so it shifts nothing.
    let insertedChars = 0;

    for (const { op, offset: acceptedOffset } of withAcceptedOffsets(block.ops)) {
      const tokenLen = op.text.length;
      if (op.type === "keep") continue;
      if (!inScope(scope, op.groupId)) continue;

      if (op.type === "delete") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
        if (range) {
          tr.delete(range.from + insertedChars, range.to + insertedChars);
          insertedChars -= tokenLen;
        }
      } else if (op.type === "insert") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset);
        if (range) {
          const content = insertedContent(op, schema);
          tr.insert(range.from + insertedChars, content);
          insertedChars += content.size;
        }
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
  scope: GroupScope,
): void {
  const state    = editor.getState();
  const schema   = state.schema;
  const authorID = "ai:assistant";
  const now      = Date.now();

  const resolved = resolveBlocksInReverse(state, blocks);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    // How far this walker's own writes have shifted the doc. Not shareable
    // with the other walkers: a tracked delete marks text instead of removing
    // it, so it shifts nothing.
    let insertedChars = 0;

    for (const { op, offset: acceptedOffset } of withAcceptedOffsets(block.ops)) {
      const tokenLen = op.text.length;
      if (op.type === "keep") continue;
      if (!inScope(scope, op.groupId)) continue;

      const baseAttrs = createNewPendingAttrs(now, authorID);

      if (op.type === "delete") {
        const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + tokenLen);
        if (range) {
          const dataTracked = addTrackIdIfDoesntExist(createNewDeleteAttrs(baseAttrs)) as Record<string, unknown>;
          if (op.groupId) dataTracked["groupId"] = op.groupId;
          applyTrackedDelete(tr, range.from + insertedChars, range.to + insertedChars, dataTracked, schema);
        }
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
  // No groupId means reject every group, which is what an unscoped scope says.
  const rejectScope = groupId ? new Set([groupId]) : undefined;
  const resolved = resolveBlocksInReverse(state, affectedBlocks);

  const tr = state.tr;

  for (const { block, found } of resolved) {
    const { map } = buildAcceptedTextMap(found.node, found.pos, schema);

    // How far this walker's own writes have shifted the doc. Not shareable
    // with the other walkers: a tracked delete marks text instead of removing
    // it, so it shifts nothing.
    let insertedChars = 0;

    for (const { op, offset: acceptedOffset } of withAcceptedOffsets(block.ops)) {
      const tokenLen = op.text.length;
      if (op.type === "keep") continue;
      if (!inScope(rejectScope, op.groupId)) continue;

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
      }
    }
  }

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  editor.applyTransaction(tr);

  if (groupId) {
    settleGroups(editor, ps.suggestion, new Set([groupId]), false);
    return;
  }

  // Remove rejected block(s) from the suggestion; clear when none remain
  const remaining = blockId
    ? ps.suggestion.blocks.filter((b) => b.nodeId !== blockId)
    : [];
  showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
}
