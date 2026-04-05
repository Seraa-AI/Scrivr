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

import type { EditorState } from "prosemirror-state";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap } from "../track-changes/lib/acceptedTextMap";
import { diffText, pairReplacements } from "../track-changes/lib/diffText";
import type { PairedDiffOp } from "../track-changes/lib/diffText";
import type { AiSuggestion, AiSuggestionBlock, AiOp } from "./types";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ComputeAiSuggestionOptions {
  /** One entry per block to rewrite. */
  blocks: Array<{ nodeId: string; proposedText: string }>;
  /** Author identifier for the suggestion, e.g. "AI Assistant". */
  authorID: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple unique id — no external dep needed for a suggestion id. */
function genId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
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

  for (const { nodeId, proposedText } of inputBlocks) {
    const found = findNodeById(state.doc, nodeId);
    if (!found) continue;

    const { acceptedText } = buildAcceptedTextMap(
      found.node,
      found.pos,
      schema,
    );

    // No change for this block — skip entirely.
    if (acceptedText === proposedText) continue;

    const rawOps = diffText(acceptedText, proposedText);
    const paired = pairReplacements(rawOps);
    const ops = toDiffOps(paired);

    // Only include the block if it has at least one non-keep op.
    const hasChange = ops.some((o) => o.type !== "keep");
    if (!hasChange) continue;

    resultBlocks.push({ nodeId, acceptedText, ops });
  }

  if (resultBlocks.length === 0) return null;

  return {
    blocks: resultBlocks,
  };
}
