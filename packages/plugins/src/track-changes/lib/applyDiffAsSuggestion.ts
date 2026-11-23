/**
 * applyDiffAsSuggestion / applyMultiBlockDiff
 *
 * Turn proposed text for a block into a suggestion on the live document.
 *
 * Single-block flow (applyDiffAsSuggestion):
 *   1. Find the block node by its `nodeId` attribute.
 *   2. Withdraw the author's earlier suggestion there (`clearAuthorPendingMarks`).
 *   3. Build the accepted-text map for that node; a line break reads as "\n".
 *   4. Diff acceptedText → proposedText, word by word.
 *   5. Group each run of changes into one phrase replacement — never across a
 *      line break, an inline object or another suggestion.
 *   6. Write each phrase as the plain edit a person would make, under
 *      `trackAsSuggestion`; the engine records it, pairing each replacement.
 *   7. Dispatch, unless the suggestion would not be recorded
 *      (`suggestionBlocked`).
 *
 * Multi-block flow (applyMultiBlockDiff):
 *   Same pipeline, but across an array of { nodeId, proposedText } pairs.
 *   Blocks are processed in reverse document order so inserts/deletes in
 *   one block do not shift positions of blocks above it in the same transaction.
 *   All changes land in a single transaction → one undo step.
 *
 * Returns { applied, editDensity }, and for multiple blocks `rejected`:
 *   applied     — true if the suggestion was dispatched
 *   rejected    — blocks the call named more than once, left alone
 *   editDensity — fraction of original chars deleted (0–1), weighted by
 *                 source-character count across all blocks.
 *                 Callers can use this as a quality gate:
 *                   < 0.2 → small edit, show fine-grained marks inline
 *                   0.2–0.7 → moderate rewrite, show marks + summary banner
 *                   > 0.7 → full rewrite, offer "Accept rewrite" button
 */

import { spansToFragment } from "@scrivr/core";
import type { Node as PMNode, Schema } from "@scrivr/core/pm";
import type { EditorState, Transaction } from "@scrivr/core/pm";

import { findLiveNodeById } from "../liveNode";
import { getBlockInlineTrackedData, ownedBy, type Owner } from "../helpers";
import { CHANGE_OPERATION, CHANGE_STATUS } from "../types";
import { bridgeable, buildAcceptedTextMap } from "./acceptedTextMap";
import { computeEditDensity, diffText, phraseReplacements } from "./diffText";
import { groupToSpans, plainProposalMarks } from "./plainProposalMarks";
import { writeProposal } from "./writeProposal";
import { dispatchSuggestion } from "../suggestionBlocked";

// ── Clear previous suggestions ────────────────────────────────────────────────

/**
 * Withdraws `authorID`'s pending suggestion within `[nodeFrom+1, nodeTo-1]`,
 * so a new proposal replaces it rather than stacking on it.
 *
 * Text or an inline object the author inserted is deleted, so positions snap
 * back before the new diff runs. Text the author proposed deleting has its
 * mark removed, and an inline object (a break, an image) its record, so it is
 * live again and the new diff re-deletes it only if still needed.
 *
 * Inside a transaction tracked as a suggestion none of this is recorded:
 * deleting one's own insertion takes it back, and rewriting review records is
 * bookkeeping.
 *
 * Deletions are applied in reverse position order so earlier positions remain
 * stable as we go.
 */
export function clearAuthorPendingMarks(
  tr: Transaction,
  nodeFrom: number,
  nodeTo: number,
  owner: Owner,
  schema: Schema,
): void {
  const insertType = schema.marks.trackedInsert;
  const deleteType = schema.marks.trackedDelete;
  if (!insertType || !deleteType) return;

  // Collect ranges to delete (previous tracked inserts) — must be done in
  // reverse order to keep positions stable.
  const insertRanges: Array<{ from: number; to: number }> = [];
  // Deduplicate by text node start position. With excludes:"" a single text
  // node can accumulate many trackedInsert marks from repeated AI calls.
  // Without deduplication, tr.delete() is called once per mark at the same
  // position, which in a PM transaction cascades into deleting N adjacent chars.
  const seenInsertFrom = new Set<number>();

  // Walk the block content (nodeFrom+1 skips the opening token).
  tr.doc.nodesBetween(nodeFrom + 1, nodeTo - 1, (child, pos) => {
    // A break or other inline object is recorded on the node, not a mark.
    if (child.isInline && !child.isText) {
      if (ownPending(child, owner, CHANGE_OPERATION.insert)) {
        insertRanges.push({ from: pos, to: pos + child.nodeSize });
      } else if (ownPending(child, owner, CHANGE_OPERATION.delete)) {
        const kept = (getBlockInlineTrackedData(child) ?? []).filter((record) => !isOwnPending(record, owner, CHANGE_OPERATION.delete));
        // An empty list is the schema default: the node as it was before any record.
        tr.setNodeAttribute(pos, "dataTracked", kept);
      }
      return;
    }
    if (!child.isText) return;
    const from = pos;
    const to = pos + child.nodeSize;

    for (const mark of child.marks) {
      const data: { authorID?: string; operationId?: string; status?: string } | null = mark.attrs.dataTracked;
      if (!data || !ownedBy(data, owner) || data.status !== CHANGE_STATUS.pending) continue;

      if (mark.type === insertType) {
        // This text was inserted by the author's previous suggestion — queue
        // for deletion so it doesn't interfere with the new diff.
        // Only add once per text node even if it has multiple stacked marks.
        if (!seenInsertFrom.has(from)) {
          seenInsertFrom.add(from);
          insertRanges.push({ from, to });
        }
      } else if (mark.type === deleteType) {
        // The author marked this text as deleted. Remove the mark so the text
        // is "live" again and the new diff can re-delete it if needed.
        tr.removeMark(from, to, mark);
      }
    }
  });

  // Delete previously-inserted ranges in reverse order (last → first).
  insertRanges.sort((a, b) => b.from - a.from);
  for (const { from, to } of insertRanges) {
    tr.delete(from, to);
  }
}

/** Whether an inline node carries `owner`'s pending `operation` as its own record. */
function ownPending(node: PMNode, owner: Owner, operation: CHANGE_OPERATION): boolean {
  return (getBlockInlineTrackedData(node) ?? []).some((record) => isOwnPending(record, owner, operation));
}

const isOwnPending = (record: { authorID?: string; operationId?: string; status?: string; operation?: string }, owner: Owner, operation: CHANGE_OPERATION) =>
  ownedBy(record, owner) && record.status === CHANGE_STATUS.pending && record.operation === operation;

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
  /** The host's name for this suggestion, stored on every change it writes. */
  operationId?: string;
}

export interface MultiBlockDiffOptions {
  /** One entry per block to rewrite. Order does not matter — sorted internally. */
  blocks: Array<{ nodeId: string; proposedText: string }>;
  /** Author ID to attribute all suggestions to (e.g. "AI Assistant"). */
  authorID: string;
  /** The host's name for this suggestion, stored on every change it writes. */
  operationId?: string;
}

export interface ApplyDiffResult {
  /** true if the suggestion was dispatched. */
  applied: boolean;
  /**
   * Fraction of original characters that were deleted (0–1), weighted by
   * source-character count so short paragraphs don't skew the result.
   * 0 = no changes (or pure insertion), 1 = everything deleted.
   */
  editDensity: number;
}

export interface MultiBlockDiffResult extends ApplyDiffResult {
  /** nodeIds the call named more than once; each is left alone, and the rest still applies. */
  rejected: string[];
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
  /** The id the caller resolved `found` by, so it can be resolved again after edits. */
  nodeId: string,
  found: ReturnType<typeof findLiveNodeById> & {},
  proposedText: string,
  owner: Owner,
): { applied: boolean; editDensity: number; sourceChars: number } {
  const schema = state.schema;

  // Withdraw this suggestion's own pending changes on the block before diffing,
  // so re-applying it replaces them; another suggestion's are left as they are.
  const nodeFrom = found.pos;
  const nodeTo   = found.pos + found.node.nodeSize;
  const stepsBefore = tr.steps.length;
  clearAuthorPendingMarks(tr, nodeFrom, nodeTo, owner, schema);
  // Restating the original withdraws the author's earlier suggestion: a change.
  const withdrew = tr.steps.length > stepsBefore;

  // Re-resolve the node after mutations (positions may have shifted).
  const updatedFound = findLiveNodeById(tr.doc, nodeId);
  if (!updatedFound) return { applied: withdrew, editDensity: 0, sourceChars: 0 };

  const { acceptedText, map } = buildAcceptedTextMap(updatedFound.node, updatedFound.pos, schema);

  if (acceptedText === proposedText) {
    return { applied: withdrew, editDensity: 0, sourceChars: acceptedText.length };
  }

  const rawOps      = diffText(acceptedText, proposedText);
  const editDensity = computeEditDensity(rawOps);
  const ops         = phraseReplacements(rawOps, (from, to) => bridgeable(tr.doc, map, from, to));
  const parentType  = updatedFound.node.type;
  const marksAt     = plainProposalMarks(ops, updatedFound.node, schema);
  const contentFor  = (from: number, to: number) =>
    spansToFragment(groupToSpans(proposedText, marksAt, from, to), schema, { parentType });

  const wrote = writeProposal(tr, map, tr.steps.length, ops, contentFor, updatedFound.pos + 1);
  return { applied: wrote || withdrew, editDensity, sourceChars: acceptedText.length };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply `proposedText` as a tracked suggestion on the block identified by
 * `nodeId`, attributed to `authorID`.
 *
 * @param state     Current editor state (used for schema + doc).
 * @param dispatch  PM dispatch function. Called with the built transaction.
 * @returns         { applied, editDensity, rejected }
 */
export function applyDiffAsSuggestion(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { nodeId, proposedText, authorID, operationId }: ApplyDiffOptions,
): ApplyDiffResult {
  const found = findLiveNodeById(state.doc, nodeId);
  if (!found) return { applied: false, editDensity: 0 };

  const tr = state.tr;
  const { applied, editDensity } = applyBlockToTr(state, tr, nodeId, found, proposedText, ownerOf(authorID, operationId));

  if (!applied) return { applied: false, editDensity };
  return { applied: dispatchSuggestion(state, tr, authorID, dispatch, operationId), editDensity };
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
  { blocks, authorID, operationId }: MultiBlockDiffOptions,
): MultiBlockDiffResult {
  const rejected = namedMoreThanOnce(blocks, state.doc);
  // Drop repeated blocks and those no longer in the doc.
  const resolved = blocks.flatMap(b => {
    if (rejected.includes(b.nodeId)) return [];
    const found = findLiveNodeById(state.doc, b.nodeId);
    return found ? [{ nodeId: b.nodeId, found, proposedText: b.proposedText }] : [];
  });

  if (resolved.length === 0) return { applied: false, editDensity: 0, rejected };

  // Reverse doc order — process last block first so upstream positions stay stable.
  resolved.sort((a, b) => b.found.pos - a.found.pos);

  const tr = state.tr;
  const density = { weighted: 0, sourceChars: 0 };
  let anyApplied = false;

  for (const { nodeId, found, proposedText } of resolved) {
    const result = applyBlockToTr(state, tr, nodeId, found, proposedText, ownerOf(authorID, operationId));
    if (result.applied) anyApplied = true;
    density.weighted    += result.editDensity * result.sourceChars;
    density.sourceChars += result.sourceChars;
  }

  if (!anyApplied) return { applied: false, editDensity: 0, rejected };

  const editDensity = density.sourceChars > 0
    ? density.weighted / density.sourceChars
    : 0;

  return { applied: dispatchSuggestion(state, tr, authorID, dispatch, operationId), editDensity, rejected };
}

/**
 * The blocks of `doc` a call names more than once, each id once. An agent
 * writes every edit in a call against the document as it found it, so a
 * second edit of one block would land on text the first already changed.
 * An id no block has is not one: it is reported missing, as any other is.
 */
export function namedMoreThanOnce(edits: ReadonlyArray<{ nodeId: string }>, doc: PMNode): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { nodeId } of edits) {
    if (seen.has(nodeId) && findLiveNodeById(doc, nodeId)) repeated.add(nodeId);
    seen.add(nodeId);
  }
  return [...repeated];
}

/** The writer a lane writes as: its author, and the suggestion when the host named one. */
export const ownerOf = (authorID: string, operationId?: string): Owner =>
  operationId ? { authorID, operationId } : { authorID };
