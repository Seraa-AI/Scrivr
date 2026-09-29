/**
 * Settling one group rebases what is left onto the document it left behind.
 *
 * A suggestion's ops are offsets into a snapshot of the block's text. Accepting
 * or rejecting one group changes that text, so every remaining op is describing
 * a document that no longer exists — the next accept lands on the wrong
 * characters, or past the end and silently does nothing.
 *
 * Marking the settled group and walking around it does not fix that: the
 * offsets are still the old ones. The remaining proposal has to be re-expressed
 * against the new text, which is what this does — reconstruct what the agent
 * still wants, then diff it against the document as it now stands.
 *
 * Doing it at settlement time is what keeps it simple: the outcome is known
 * here, so nothing has to be recorded and consulted later.
 */
import type { IBaseEditor, InlineMark } from "@scrivr/core";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { computeAiSuggestion } from "./computeAiSuggestion";
import type { AiSuggestion, AiSuggestionBlock } from "./types";
import type { InlineSpan } from "../schema/edit";
import { currentMarksAt, sameMarks } from "./marks";

/**
 * What the agent still wants this block to read as, in the document's terms.
 *
 * Runs that are not part of a live proposal carry the document's own formatting,
 * so re-diffing sees no change in them rather than proposing to strip it. That
 * formatting is read per character, not once per run: the document can change
 * formatting inside a word, and a run that took its first character's marks
 * would ask to strip every other formatting it spanned.
 */
function remainingProposal(
  block: AiSuggestionBlock,
  settledGroupId: string,
  accepted: boolean,
  docMarks: InlineMark[][],
): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let docCursor = 0;

  const push = (text: string, marks: InlineMark[]) => {
    if (text.length > 0) spans.push({ text, marks });
  };

  /**
   * Emit `text` wearing the formatting the document gives it, split wherever
   * that formatting changes — which can happen inside a word.
   */
  const pushAsDocumentReads = (text: string, at: number) => {
    let runStart = 0;
    for (let i = 1; i <= text.length; i++) {
      const here = docMarks[at + i] ?? [];
      const prev = docMarks[at + i - 1] ?? [];
      if (i < text.length && sameMarks(here, prev)) continue;
      push(text.slice(runStart, i), prev);
      runStart = i;
    }
  };

  for (const op of block.ops) {
    const settled = op.groupId === settledGroupId;
    const rejected = settled && !accepted;

    if (op.type === "keep") {
      // A live formatting proposal states its own marks for the whole run;
      // anything else wears the document's, boundaries included.
      if (op.marks && !settled) push(op.text, op.marks);
      else pushAsDocumentReads(op.text, docCursor);
      docCursor += op.text.length;
      continue;
    }

    if (op.type === "delete") {
      if (rejected) {
        // The reader kept this text, so it is in the document and stays.
        pushAsDocumentReads(op.text, docCursor);
        docCursor += op.text.length;
      } else if (!settled) {
        // Still proposed for removal: present in the document, absent from the
        // proposal.
        docCursor += op.text.length;
      }
      // Accepted: already gone from the document, and gone from the proposal.
      continue;
    }

    if (rejected) continue;               // turned down, never written
    if (settled) {
      // Accepted: the document has it now.
      pushAsDocumentReads(op.text, docCursor);
      docCursor += op.text.length;
    } else {
      // Still proposed: not in the document yet, so it brings its own marks.
      push(op.text, op.marks ?? []);
    }
  }

  return spans;
}

/**
 * Re-express a suggestion against the document a settled group left behind.
 *
 * Returns the suggestion with this block's proposal rebuilt, the block dropped
 * when nothing remains of it, or `null` when no block has anything left to say
 * — a finished proposal is not a proposal, and leaving it in place is how an
 * empty one gets reported as a deletion of the whole paragraph.
 */
export function rebaseAfterSettle(
  editor: IBaseEditor,
  suggestion: AiSuggestion,
  nodeId: string,
  settledGroupId: string,
  accepted: boolean,
): AiSuggestion | null {
  const block = suggestion.blocks.find((b) => b.nodeId === nodeId);
  const state = editor.getState();
  const found = block ? findNodeById(state.doc, block.nodeId) : null;
  const others = suggestion.blocks.filter((b) => b.nodeId !== nodeId);

  // The block is no longer in the document — removed by this edit, by a
  // collaborator, or by an undo. There is nothing to rebase onto and nothing
  // left to propose about it, so it goes rather than keeping a card that
  // points nowhere and a settled group that could be applied again.
  if (!block || !found) return others.length > 0 ? { ...suggestion, blocks: others } : null;

  const spans = remainingProposal(block, settledGroupId, accepted, currentMarksAt(found.node));
  const rebuilt = computeAiSuggestion(state, {
    blocks: [{
      nodeId: block.nodeId,
      // No spans left means the remainder empties the block — which is a
      // proposal, not the absence of one. Said as text, because empty spans
      // read on the other side as "the agent said nothing".
      ...(spans.length > 0 ? { proposedSpans: spans } : { proposedText: "" }),
      ...(block.summary ? { summary: block.summary } : {}),
    }],
    authorID: suggestion.author ?? "AI Assistant",
  });

  const next = rebuilt?.blocks[0];
  const blocks = next ? [...others, next] : others;
  if (blocks.length === 0) return null;

  // Keep document order, which the overlay and the card list both read.
  const order = new Map(suggestion.blocks.map((b, i) => [b.nodeId, i]));
  blocks.sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));
  return { ...suggestion, blocks };
}
