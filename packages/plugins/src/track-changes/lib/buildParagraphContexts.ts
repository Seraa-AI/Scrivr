/**
 * buildParagraphContexts
 *
 * Walks the document and returns one ParagraphContext per block node that has
 * a stable `nodeId` attribute. This is the structured context sent to the AI:
 *
 *   acceptedText  — clean "accept-all" text the AI proposes changes against
 *   decoratedText — pseudo-XML showing existing tracked changes for context
 *
 * Only nodes that carry `nodeId` (set by the UniqueId extension) are included.
 * Nodes without text content are skipped.
 */

import type { IEditor } from "@inscribe/core";

import { buildAcceptedTextMap } from "./acceptedTextMap";

export interface ParagraphContext {
  /** Stable block node identifier (set by UniqueId extension). */
  nodeId: string;
  /**
   * The "accept-all" plain text view of this paragraph.
   * AI proposals target this string — the client diffs against it.
   */
  acceptedText: string;
  /**
   * Pseudo-XML decorated text showing existing tracked changes.
   * Used in the AI system prompt so the model is aware of pending edits.
   *
   * Example:
   *   The <del author="Bob">quick </del><ins author="Bob">agile </ins>brown fox.
   */
  decoratedText: string;
}

/**
 * Build the paragraph contexts for the current document state.
 *
 * @param editor  The live editor instance (used to read current state + schema).
 * @returns       Array of ParagraphContext, one per nodeId-bearing block node.
 */
export function buildParagraphContexts(editor: IEditor): ParagraphContext[] {
  const state = editor.getState();
  const { doc, schema } = state;

  const contexts: ParagraphContext[] = [];

  doc.descendants((node, pos) => {
    // Only process block nodes with a nodeId
    if (!node.isBlock) return true;
    const nodeId: string | null = node.attrs["nodeId"] ?? null;
    if (!nodeId) return true;

    // Skip empty / non-text blocks (e.g. horizontal rules, images)
    if (node.textContent.length === 0) return true;

    const { acceptedText, decoratedText } = buildAcceptedTextMap(node, pos, schema);

    if (acceptedText.length === 0 && decoratedText.length === 0) return true;

    contexts.push({ nodeId, acceptedText, decoratedText });

    // Don't descend into children — block nodes are the unit of granularity
    return false;
  });

  return contexts;
}
