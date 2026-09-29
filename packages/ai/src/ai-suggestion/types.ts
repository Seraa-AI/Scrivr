/**
 * types.ts
 *
 * Shared types for the ai-suggestion module.
 */
import type { InlineMark } from "@scrivr/core";

/**
 * Font info for rendering ghost text inline.
 */
export interface TextStyle {
  fontFamily: string;
  fontSize:   number;
  fontWeight: string;  // "normal" | "bold"
  fontStyle:  string;  // "normal" | "italic"
}

/**
 * Type of AI operation.
 */
export type AiOpType = "keep" | "insert" | "delete";

/**
 * An AI operation, either a keep, insert, or delete.
 */
export interface AiOp {
  type: AiOpType;
  text: string;
  /**
   * One addressable unit of the proposal — a paired delete+insert that together
   * replace a phrase, or a single keep whose formatting changes. Accepting or
   * rejecting a group settles exactly that unit.
   */
  groupId?: string;
  /**
   * On an `insert`, the formatting the new text carries; absent means unmarked.
   *
   * On a `keep`, the formatting *changes here* — the run stays, and this is what
   * it should read as. Absent means the run already reads that way and nothing
   * is being proposed for it, so an unmarked keep must not be treated as "make
   * this plain". A run is split wherever either side's formatting changes, so an
   * op always describes one formatting.
   *
   * `delete` ops describe text already in the document and carry none.
   */
  marks?: InlineMark[];
}

/**
 * One block (paragraph, heading, etc.) that has pending AI suggestion ops.
 */
export interface AiSuggestionBlock {
  /** Stable nodeId of the ProseMirror block node */
  nodeId: string;
  /** The accepted text at the time the suggestion was applied */
  acceptedText: string;
  /** The ordered list of diff operations for this block */
  ops: AiOp[];
  /**
   * Groups the reader has already accepted or rejected. A resolved group is
   * finished — apply and reject both skip it, so accepting the rest of a
   * suggestion cannot re-apply something already turned down.
   */
  resolvedGroups?: string[];
  /**
   * Optional human-authored summary for this block's change.
   * e.g. "Simplified tone and removed jargon"
   * When present, UIs should prefer this over the auto-derived label.
   */
  summary?: string;
}

/**
 * The full AI suggestion payload — one or more blocks with pending ops.
 */
export interface AiSuggestion {
  /** Human-readable label for the suggestion (shown in edge cards) */
  label?: string;
  /** Suggestion author (e.g. "AI Assistant") */
  author?: string;
  /** All blocks affected by this suggestion */
  blocks: AiSuggestionBlock[];
}

/**
 * State of the AI suggestion plugin.
 */
export interface AiSuggestionPluginState {
  suggestion:    AiSuggestion | null;
  staleBlockIds: ReadonlySet<string>;
  /** nodeId being hovered in a React edge card — dispatched via meta */
  hoverBlockId:  string | null;
  /** nodeId of the block whose range contains the cursor — dispatched via meta */
  activeBlockId: string | null;
}

/**
 * Options for applying an AI suggestion.
 */
export interface ApplyAiSuggestionOptions {
  groupId?: string;
  /** If provided, only apply changes in this block. */
  blockId?: string;
  mode: "direct" | "tracked";
}

/**
 * Options for rejecting an AI suggestion.
 */
export interface RejectAiSuggestionOptions {
  groupId?: string;
  /** If provided, reject all changes in this block only. */
  blockId?: string;
}
