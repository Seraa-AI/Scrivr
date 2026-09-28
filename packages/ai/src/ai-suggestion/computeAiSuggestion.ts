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

import type { EditorState, Node as PmNode } from "@scrivr/core/pm";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap } from "@scrivr/plugins";
import { diffText, pairReplacements } from "@scrivr/plugins";
import type { PairedDiffOp } from "@scrivr/plugins";
import type { InlineMark, InlineSpan } from "@scrivr/core";
import type { AiSuggestion, AiSuggestionBlock, AiOp } from "./types";

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
     * The proposed wording as formatting runs. Carries what `proposedText`
     * cannot: which parts of the new wording are bold, linked, highlighted —
     * and lets a proposal be about formatting alone, where the words are
     * unchanged. Takes precedence when both are given.
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
}): { text: string; marksAt: InlineMark[][] } | null {
  if (block.proposedSpans) {
    let text = "";
    const marksAt: InlineMark[][] = [];
    for (const span of block.proposedSpans) {
      text += span.text;
      for (let i = 0; i < span.text.length; i++) marksAt.push(span.marks);
    }
    return { text, marksAt };
  }
  if (block.proposedText === undefined) return null;
  // Plain text says nothing about formatting, which is the same as no marks.
  return { text: block.proposedText, marksAt: [] };
}

/**
 * Does the block already read the way the proposal asks? Compares the marks the
 * proposal assigns each character against the marks the block's text carries, so
 * a proposal that only restates the current formatting is not a suggestion.
 */
function marksMatchBlock(node: PmNode, marksAt: InlineMark[][]): boolean {
  const current: InlineMark[][] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return;
    const marks = child.marks
      .filter((mark) => mark.type.name !== "trackedInsert" && mark.type.name !== "trackedDelete")
      .map((mark) =>
        Object.keys(mark.attrs).length > 0
          ? { type: mark.type.name, attrs: mark.attrs }
          : { type: mark.type.name },
      );
    for (let i = 0; i < child.text.length; i++) current.push(marks);
  });
  if (current.length !== marksAt.length) return false;
  return current.every((marks, i) => sameMarks(marks, marksAt[i] ?? []));
}

/**
 * Two runs read the same way — so they can stay one op.
 *
 * Order-insensitive and attrs-aware, because the two sides come from different
 * places: document marks arrive in schema order, and an agent emits them in
 * whatever order it wrote them. Comparing those literally would read a reordered
 * `[bold, italic]` as a formatting change.
 */
function markKey(mark: InlineMark): string {
  return JSON.stringify([mark.type, mark.attrs ?? null]);
}

function sameMarks(a: readonly InlineMark[], b: readonly InlineMark[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(markKey).sort();
  const right = b.map(markKey).sort();
  return left.every((key, i) => key === right[i]);
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
 * Convert PairedDiffOp[] (from diffText + pairReplacements) to AiOp[].
 *
 * pairReplacements assigns a groupId to paired delete+insert ops. Standalone
 * deletes or inserts (no natural pair within the look-ahead window) get a
 * generated groupId so the API surface is uniform — every non-keep op can be
 * individually accepted or rejected via groupId.
 */
function toDiffOps(pairedOps: PairedDiffOp[]): AiOp[] {
  return pairedOps.map((op, i): AiOp => {
    if (op.type === "keep") return { type: "keep", text: op.text };
    // Use the existing groupId from pairReplacements, or generate a unique one
    // for standalone ops that weren't paired (no matching insert/delete nearby).
    const gid = op.groupId ?? `solo_${i}`;
    if (op.type === "delete")
      return { type: "delete", text: op.text, groupId: gid };
    return { type: "insert", text: op.text, groupId: gid };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute an AI suggestion for one or more blocks.
 *
 * @param state    Current editor state (read-only — not mutated).
 * @param options  Blocks to rewrite and the author ID.
 * @returns        A serializable AiSuggestion, or null if no meaningful changes
 *                 were found (every proposed text is identical to the current
 *                 accepted text).
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
    const proposal = readProposal(block);
    if (!proposal) continue;
    const found = findNodeById(state.doc, nodeId);
    if (!found) continue;

    const { acceptedText } = buildAcceptedTextMap(
      found.node,
      found.pos,
      schema,
    );

    const rawOps = diffText(acceptedText, proposal.text);
    const paired = pairReplacements(rawOps);

    // Ops that consume the proposal carry its formatting; a delete describes
    // text already in the document, so it advances neither.
    let proposedOffset = 0;
    const ops: AiOp[] = [];
    for (const op of toDiffOps(paired)) {
      if (op.type === "delete") {
        ops.push(op);
        continue;
      }
      ops.push(...splitByMarks(op, proposal.marksAt, proposedOffset));
      proposedOffset += op.text.length;
    }

    // A wording change shows up as a non-keep op. A formatting-only change does
    // not — every op is a keep — so compare the formatting the block would end
    // up with against the formatting it has.
    const hasWordingChange = ops.some((o) => o.type !== "keep");
    const hasFormattingChange =
      proposal.marksAt.length > 0 && !marksMatchBlock(found.node, proposal.marksAt);
    if (!hasWordingChange && !hasFormattingChange) continue;

    resultBlocks.push({ nodeId, acceptedText, ops, ...(summary ? { summary } : {}) });
  }

  if (resultBlocks.length === 0) return null;

  return {
    blocks: resultBlocks,
  };
}
