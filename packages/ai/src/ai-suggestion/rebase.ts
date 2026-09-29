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
import { buildAcceptedTextMap, isTrackedMark } from "@scrivr/plugins";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { describeInlineMark } from "@scrivr/core";
import { computeAiSuggestion } from "./computeAiSuggestion";
import type { AiSuggestion, AiSuggestionBlock } from "./types";
import type { InlineSpan } from "../schema/edit";
import type { Node as PmNode } from "@scrivr/core/pm";

/** The formatting each character of the block's accepted text now carries. */
function currentMarksAt(node: PmNode): InlineMark[][] {
  const marks: InlineMark[][] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((mark) => mark.type.name === "trackedDelete")) return;
    const described = child.marks.filter((m) => !isTrackedMark(m.type.name)).map(describeInlineMark);
    for (let i = 0; i < child.text.length; i++) marks.push(described);
  });
  return marks;
}

/**
 * What the agent still wants this block to read as, in the document's terms.
 *
 * Walks the settled block's ops against the text the document now holds. Each
 * op is one of three things: text the document still has (so the walk advances
 * over it), text the document no longer has, or text it does not have yet.
 * Which of those an op is depends on whether its group was the one settled and
 * on how it was settled — an accepted delete is gone, a rejected one stayed.
 *
 * Runs that are not part of a live proposal carry the document's own formatting,
 * so re-diffing sees no change in them rather than proposing to strip it.
 */
function remainingProposal(
  block: AiSuggestionBlock,
  settledGroupId: string,
  accepted: boolean,
  docMarks: InlineMark[][],
): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let docCursor = 0;

  const take = (length: number): InlineMark[] => docMarks[docCursor] ?? [];
  const push = (text: string, marks: InlineMark[]) => {
    if (text.length > 0) spans.push({ text, marks });
  };

  for (const op of block.ops) {
    const settled = op.groupId === settledGroupId;
    const rejected = settled && !accepted;

    if (op.type === "keep") {
      // A live formatting proposal keeps its marks; anything else takes the
      // document's, so it reads as unchanged.
      const marks = op.marks && !settled ? op.marks : take(op.text.length);
      push(op.text, marks);
      docCursor += op.text.length;
      continue;
    }

    if (op.type === "delete") {
      if (rejected) {
        // The reader kept this text, so it is in the document and stays.
        push(op.text, take(op.text.length));
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
      push(op.text, take(op.text.length));
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
  if (!block || !found) return suggestion;

  const proposedSpans = remainingProposal(block, settledGroupId, accepted, currentMarksAt(found.node));
  const rebuilt = computeAiSuggestion(state, {
    blocks: [{ nodeId: block.nodeId, proposedSpans, ...(block.summary ? { summary: block.summary } : {}) }],
    authorID: suggestion.author ?? "AI Assistant",
  });

  const others = suggestion.blocks.filter((b) => b.nodeId !== nodeId);
  const next = rebuilt?.blocks[0];
  const blocks = next ? [...others, next] : others;
  if (blocks.length === 0) return null;

  // Keep document order, which the overlay and the card list both read.
  const order = new Map(suggestion.blocks.map((b, i) => [b.nodeId, i]));
  blocks.sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));
  return { ...suggestion, blocks };
}
