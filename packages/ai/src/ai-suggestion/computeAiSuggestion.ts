/**
 * computeAiSuggestion
 *
 * Pure function — no dispatch, no document mutation.
 *
 * Computes a word-level diff between each block's current accepted text and the
 * AI-proposed replacement, then packages the result as a serializable
 * AiSuggestion that can be:
 *   - saved to a DB as plain JSON
 *   - passed to showAiSuggestion() to render as an overlay
 *   - passed to applyAiSuggestion() to commit to the document
 *
 * Notably does NOT call expandCharLevel — AI suggestions stay at word/token
 * granularity. Character-level surgical marks are appropriate for human edits
 * (where lawyers want to see exactly which suffix changed) but produce visual
 * noise for AI suggestions where the unit of accept/reject is a whole word.
 */

import type { EditorState, Node as PmNode, Schema } from "@scrivr/core/pm";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { diffText, pairReplacements } from "@scrivr/plugins";
import type { PairedDiffOp } from "@scrivr/plugins";
import { describeInlineMark, resolveInlineMarks, stableStringify, type InlineMark } from "@scrivr/core";
import type { InlineSpan } from "../schema/edit";
import { toCoreSpans } from "../ai-toolkit/spans";
import type { AiSuggestion, AiSuggestionBlock, AiOp } from "./types";
import { currentMarksAt, sameMarks } from "./marks";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComputeAiSuggestionOptions {
  /** One entry per block to rewrite. */
  blocks: Array<{
    nodeId:        string;
    /**
     * The proposed wording as plain text. Equivalent to a single `proposedSpans`
     * run with no marks — a proposal that says nothing about formatting.
     */
    proposedText?: string;
    /**
     * The proposed wording as formatting runs, in the same vocabulary the edit
     * protocol validates — so `parseSemanticEdits` output feeds straight in.
     * Carries what `proposedText` cannot: which parts of the new wording are
     * bold, linked, highlighted, and lets a proposal be about formatting alone
     * where the words are unchanged. Takes precedence when both are given.
     */
    proposedSpans?: InlineSpan[];
    /** Optional human-authored summary, e.g. "Simplified tone and removed jargon". */
    summary?:      string;
  }>;
  /** Author identifier for the suggestion, e.g. "AI Assistant". */
  authorID: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple unique id — no external dep needed for a suggestion id. */
function genId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** The proposed wording and, per character, the formatting it carries. */
function readProposal(block: {
  proposedText?: string;
  proposedSpans?: InlineSpan[];
}, schema: Schema, node: PmNode): { text: string; marksAt: InlineMark[][] } | null {
  // `proposedSpans` wins only when it says something. An agent emitting `[]`
  // alongside `proposedText` means "I have no runs", not "empty this block".
  if (block.proposedSpans && block.proposedSpans.length > 0) {
    let text = "";
    const marksAt: InlineMark[][] = [];
    for (const span of toCoreSpans(block.proposedSpans)) {
      const marks = resolveInlineMarks(span.marks, schema, node.type).map(describeInlineMark);
      text += span.text;
      for (let i = 0; i < span.text.length; i++) marksAt.push(marks);
    }
    return { text, marksAt };
  }
  if (block.proposedText === undefined) return null;
  // Plain text says nothing about formatting, which is the same as no marks.
  return { text: block.proposedText, marksAt: [] };
}

/**
 * Split a keep again wherever the formatting it *currently* carries changes, so
 * each piece can be judged against a single existing formatting.
 */
function splitByCurrentMarks(op: AiOp, current: InlineMark[][], offset: number): AiOp[] {
  const out: AiOp[] = [];
  let runStart = 0;
  for (let i = 1; i <= op.text.length; i++) {
    const here = current[offset + i] ?? [];
    const prev = current[offset + i - 1] ?? [];
    if (i === op.text.length || !sameMarks(here, prev)) {
      out.push({ ...op, text: op.text.slice(runStart, i) });
      runStart = i;
    }
  }
  return out.length > 0 ? out : [op];
}

/**
 * Split an op that consumes proposed text wherever its formatting changes, so
 * every op reads one way. Ops over text already in the document (deletes) and
 * proposals made as plain text pass through untouched.
 */
function splitByMarks(op: AiOp, marksAt: InlineMark[][], offset: number): AiOp[] {
  if (marksAt.length === 0) return [op];
  const out: AiOp[] = [];
  let runStart = 0;
  for (let i = 1; i <= op.text.length; i++) {
    const here = marksAt[offset + i] ?? [];
    const prev = marksAt[offset + i - 1] ?? [];
    if (i === op.text.length || !sameMarks(here, prev)) {
      out.push({ ...op, text: op.text.slice(runStart, i), marks: prev });
      runStart = i;
    }
  }
  return out.length > 0 ? out : [op];
}

/**
 * One diff op as a suggestion op. `proposedOffset` stays behind: it is diff
 * bookkeeping the caller needs while building, not something a suggestion
 * carries into storage.
 *
 * `nodeId` prefixes the generated ids because a group is addressed across the
 * whole suggestion, and an index into one block's ops repeats in every block.
 */
function toDiffOp(op: PairedDiffOp, i: number, nodeId: string): AiOp {
  if (op.type === "keep") return { type: "keep", text: op.text };
  // Use the existing groupId from pairReplacements, or generate a unique one
  // for standalone ops that weren't paired (no matching insert/delete nearby).
  const gid = `${nodeId}_${op.groupId ?? `solo_${i}`}`;
  if (op.type === "delete")
    return { type: "delete", text: op.text, groupId: gid };
  return { type: "insert", text: op.text, groupId: gid };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute an AI suggestion for one or more blocks.
 *
 * @param state    Current editor state (read-only — not mutated).
 * @param options  Blocks to rewrite and the author ID.
 * @returns        A serializable AiSuggestion, or null when the proposal
 *                 matches the document in both words and formatting.
 *
 * @example
 * const suggestion = computeAiSuggestion(editor.getState(), {
 *   blocks: [{ nodeId, proposedText: "..." }],
 *   authorID: "AI Assistant",
 * });
 * if (suggestion) showAiSuggestion(editor, suggestion);
 */
export function computeAiSuggestion(
  state: EditorState,
  options: ComputeAiSuggestionOptions,
): AiSuggestion | null {
  const { blocks: inputBlocks } = options;
  const schema = state.schema;
  const resultBlocks: AiSuggestionBlock[] = [];

  for (const block of inputBlocks) {
    const { nodeId, summary } = block;
    const found = findNodeById(state.doc, nodeId);
    if (!found || !found.node.isTextblock) continue;
    const proposal = readProposal(block, schema, found.node);
    if (!proposal) continue;

    const { acceptedText } = buildAcceptedTextMap(
      found.node,
      found.pos,
      schema,
    );

    const rawOps = diffText(acceptedText, proposal.text);
    const paired = pairReplacements(rawOps);

    // Two cursors: one into the document's accepted text, which deletes and
    // keeps consume, and one into the proposal, which keeps and inserts consume.
    const current = currentMarksAt(found.node);
    let formatGroups = 0;
    let acceptedOffset = 0;
    const ops: AiOp[] = [];
    for (const [i, raw] of paired.entries()) {
      const op = toDiffOp(raw, i, nodeId);
      if (op.type === "delete") {
        ops.push(op);
        acceptedOffset += op.text.length;
        continue;
      }
      // Where this op sits in the proposal comes from the op itself. Counting
      // as we walk would be wrong: `pairReplacements` emits in document order,
      // which is what applying a diff needs and is not the order the proposal
      // reads in, so a counted offset lands on the wrong words.
      const proposedOffset = raw.type === "delete" ? 0 : raw.proposedOffset ?? 0;
      for (const part of splitByMarks(op, proposal.marksAt, proposedOffset)) {
        if (part.type !== "keep" || !part.marks) {
          ops.push(part);
          if (part.type === "keep") acceptedOffset += part.text.length;
          continue;
        }
        // A keep was split where the *proposal's* formatting changes. The
        // document's own formatting changes at its own boundaries — "alpha"
        // can be half bold — so split again there before deciding, or a run
        // whose first character already matches hides the rest of the change.
        for (const run of splitByCurrentMarks(part, current, acceptedOffset)) {
          const unchanged = sameMarks(run.marks ?? [], current[acceptedOffset] ?? []);
          ops.push(
            unchanged
              // Restating what a run already reads as is not a proposal.
              ? { type: "keep", text: run.text }
              // Its own group, so a reader accepts this run's formatting the
              // way they accept a word swap, scoped to the text it spoke about.
              : { ...run, groupId: `fmt_${nodeId}_${formatGroups++}` },
          );
          acceptedOffset += run.text.length;
        }
      }
    }

    // A wording change shows up as a non-keep op; a formatting change shows up
    // as a keep that carries marks. One derivation, read off the ops themselves,
    // so what the overlay draws and what the apply writes cannot disagree.
    if (!ops.some((o) => o.type !== "keep" || o.marks)) continue;

    resultBlocks.push({ nodeId, acceptedText, ops, ...(summary ? { summary } : {}) });
  }

  if (resultBlocks.length === 0) return null;

  return {
    blocks: resultBlocks,
  };
}
