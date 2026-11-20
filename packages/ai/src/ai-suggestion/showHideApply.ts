/**
 * showHideApply.ts
 *
 * Commands for showing, hiding, applying, and rejecting AI suggestions.
 *
 * The "apply" path walks each block's ops and commits them to the document
 * as tracked changes (mode: "tracked") or direct mutations (mode: "direct").
 *
 * The "reject" path discards pending proposal ops without editing the document.
 * Once applied in tracked mode, changes belong to the track-changes review API.
 */

import type { IBaseEditor } from "@scrivr/core";
import { resolveInlineMarks, describeInlineMark, sameMark, spansToFragment } from "@scrivr/core";
import type { InlineMark, InlineSpan } from "@scrivr/core";
import type { EditorState, Node as PmNode, Schema, Transaction } from "@scrivr/core/pm";
import { findLiveNodeById } from "@scrivr/plugins";
import { rebaseAfterSettle } from "./rebase";
import { groupsWithin, withAcceptedOffsets, type AcceptedSpan } from "./groupSpans";
import type { AiOp, AiSuggestion, AiSuggestionBlock, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "./types";
import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
  AI_SUGGESTION_SETTLE,
} from "./AiSuggestionPlugin";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { isTrackedMark, skipTracking, suggestionBlocked, trackAsSuggestion, writeProposal } from "@scrivr/plugins";
import { acceptedRangeToDocRange } from "@scrivr/plugins";

/** The blocks still in the document, each with where it is. */
function resolveBlocks(
  state: EditorState,
  blocks: AiSuggestionBlock[],
): Array<{ block: AiSuggestionBlock; found: { node: PmNode; pos: number } }> {
  const resolved = blocks.flatMap((block) => {
    const found = findLiveNodeById(state.doc, block.nodeId);
    return found ? [{ block, found }] : [];
  });
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
 * mode "tracked" — writes them as suggestions, which track changes records.
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
  const author = authorOf(ps.suggestion);
  applyProposal(editor, affectedBlocks, scope, mode, author);

  if (groupId) {
    const wrote = editor.getState().doc !== before;
    if (wrote) settleGroups(editor, ps.suggestion, new Set([groupId]), true);
    return wrote;
  }

  // An apply that wrote nothing, as one tracking would not record, settles
  // nothing: the whole proposal stays for the reader.
  if (editor.getState().doc === before) return false;

  // Everything not accepted stays — the blocks this call did not ask for, and
  // the ones it refused. Clearing those too would lose a proposal the reader
  // never settled.
  const accepted = new Set(affectedBlocks.map((b) => b.nodeId));
  const remaining = ps.suggestion.blocks.filter((b) => !accepted.has(b.nodeId));
  showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
  return true;
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

  const found = findLiveNodeById(state.doc, blockId);
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
  const author = authorOf(suggestion);
  applyProposal(editor, [block], scope, mode, author);

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

/** Who applied changes are by: the suggestion's author, or the assistant for one built without one. */
function authorOf(suggestion: AiSuggestion): string {
  // An empty author is no author.
  return suggestion.author || "ai:assistant";
}

/**
 * Write the groups `scope` covers into the document, in one transaction, so an
 * apply is one undo step and lands whole or not at all.
 *
 * Formatting on kept runs goes first: a mark step moves nothing, so every range
 * still resolves against the document the suggestion was computed from. Then
 * each phrase is one plain edit, through the same writer as the other lanes.
 * Tracked mode dispatches it with suggestion intent and the engine records it,
 * so a reviewer can reject the formatting as they reject the words; it writes
 * nothing that would not be recorded. Direct mode skips tracking, which is what
 * direct means.
 *
 * A formatting keep carries its own `groupId`, so accepting one group applies
 * exactly that run's formatting — `applyRunMarks` removes what the proposal
 * omits, and the run is the only text that group spoke about. Accepting a
 * word-swap group touches no formatting, because it is a different group.
 */
function applyProposal(
  editor: IBaseEditor,
  blocks: AiSuggestionBlock[],
  scope: GroupScope,
  mode: ApplyAiSuggestionOptions["mode"],
  author: string,
): void {
  const state = editor.getState();
  const schema = state.schema;
  const resolved = resolveBlocks(state, blocks).map(({ block, found }) => ({
    block,
    found,
    map: buildAcceptedTextMap(found.node, found.pos, schema).map,
  }));
  const tr = state.tr;

  for (const { block, map } of resolved) {
    for (const { op, offset: acceptedOffset } of withAcceptedOffsets(block.ops)) {
      if (op.type !== "keep" || !op.marks || !inScope(scope, op.groupId)) continue;
      const range = acceptedRangeToDocRange(map, acceptedOffset, acceptedOffset + op.text.length);
      if (range) applyRunMarks(tr, schema, range.from, range.to, op.marks);
    }
  }

  // Every map was read from `state.doc`, the document before this transaction's first step.
  for (const { block, found, map } of resolved) {
    const ops = scopedOps(block.ops, scope);
    const contentFor = (from: number, to: number) =>
      spansToFragment(proposedSpans(ops, from, to), schema, { parentType: found.node.type });
    writeProposal(tr, map, 0, ops, contentFor, found.pos + 1);
  }

  if (!tr.docChanged) return;
  if (mode === "direct") {
    skipTracking(tr);
  } else {
    trackAsSuggestion(tr, author);
    if (suggestionBlocked(state, tr)) return;
  }
  editor.applyTransaction(tr);
}

/**
 * The ops an apply writes: those in `scope`. A deletion outside it is text
 * that stays, so it reads as kept; an insertion outside it is not written.
 */
function scopedOps(ops: readonly AiOp[], scope: GroupScope): AiOp[] {
  return ops.flatMap((op): AiOp[] => {
    if (op.type === "keep" || inScope(scope, op.groupId)) return [op];
    return op.type === "delete" ? [{ type: "keep", text: op.text }] : [];
  });
}

/**
 * The inserted text between proposed offsets `from` and `to`, with the
 * formatting each insertion proposes. An op made from plain text proposes
 * none, which `spansToFragment` renders as an unmarked run.
 */
function proposedSpans(ops: readonly AiOp[], from: number, to: number): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let offset = 0;
  for (const op of ops) {
    if (op.type === "delete") continue;
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + op.text.length);
    if (op.type === "insert" && start < end) {
      spans.push({ text: op.text.slice(start - offset, end - offset), marks: op.marks ?? [] });
    }
    offset += op.text.length;
  }
  return spans;
}

/**
 * Reject the current AI suggestion.
 *
 * Discards pending ops without changing document content or review marks.
 * Applied changes are no longer proposal ops; rejecting them belongs to the
 * track-changes API (`reviewChanges`), which addresses change IDs.
 *
 * If `blockId` is provided, only that block's pending ops are discarded.
 * If `groupId` is provided, only that group within the scope is discarded.
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

  if (groupId) {
    // Both selectors constrain the pending proposal. A group outside the
    // requested block must not settle a different block through the rebase.
    if (!affectedBlocks.some((block) => block.ops.some((op) => op.groupId === groupId))) return;
    settleGroups(editor, ps.suggestion, new Set([groupId]), false);
    return;
  }

  // Remove rejected block(s) from the suggestion; clear when none remain
  const remaining = blockId
    ? ps.suggestion.blocks.filter((b) => b.nodeId !== blockId)
    : [];
  showAiSuggestion(editor, remaining.length > 0 ? { ...ps.suggestion, blocks: remaining } : null);
}
