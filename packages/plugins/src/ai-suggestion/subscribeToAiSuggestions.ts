/**
 * subscribeToAiSuggestions.ts
 *
 * Framework-agnostic subscription for AI suggestion card data.
 * Works in vanilla JS, Vue, Svelte, or any other environment.
 *
 * Usage:
 *   const unsub = subscribeToAiSuggestions(editor, (cards, actions) => {
 *     renderMyUI(cards);
 *   }, {
 *     onFocus: (blockId) => scrollCardIntoView(blockId),
 *     onBlur:  (blockId) => void,
 *   });
 *   unsub(); // stop listening
 */

import type { IEditor } from "@scrivr/core";
import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET_HOVER,
} from "./AiSuggestionPlugin";
import { applyAiSuggestion, rejectAiSuggestion } from "./showHideApply";
import { findNodeById } from "../ai-toolkit/UniqueId";
import type { AiSuggestionBlock, AiOp, AiSuggestionPluginState } from "./types";

// ── Public types ──────────────────────────────────────────────────────────────

/** Derived card data — ready to render in any UI framework. */
export interface AiSuggestionCardData {
  /** Stable node ID — use as React/Vue key. */
  blockId: string;
  /** The raw block with ops — for custom diff rendering. */
  block: AiSuggestionBlock;
  /**
   * Display label. Prefers block.summary when present (human-authored),
   * otherwise falls back to auto-derived text from the ops.
   */
  label: string;
  /**
   * Optional authored summary passed through from block.summary.
   * Undefined when no summary was provided at compute time.
   * UIs can use this to show richer context ("Simplified tone and removed jargon").
   */
  summary: string | undefined;
  /** Semantic kind: "rewrite" | "insert" | "delete" */
  kind: "rewrite" | "insert" | "delete";
  /** True when the document has changed since the suggestion was set. */
  isStale: boolean;
  /** True when the cursor is inside this block. */
  isActive: boolean;
  /** True when the block is being hovered in the sidebar (set via actions.hover). */
  isHovered: boolean;
}

/** Actions passed to the subscriber callback — call these to drive the editor. */
export interface AiSuggestionCardActions {
  /** Accept one block. mode defaults to "tracked". */
  accept(blockId: string, mode?: "tracked" | "direct"): void;
  /** Reject one block. */
  reject(blockId: string): void;
  /** Accept all blocks. mode defaults to "tracked". */
  acceptAll(mode?: "tracked" | "direct"): void;
  /** Reject all blocks. */
  rejectAll(): void;
  /** Signal that a block is being hovered in the sidebar (updates canvas overlay). */
  hover(blockId: string | null): void;
  /** Move the editor cursor into a block (makes it "active"). */
  activate(blockId: string): void;
}

/** Optional lifecycle callbacks for focus transitions. */
export interface AiSuggestionSubscribeOptions {
  /**
   * Called when a block becomes active (cursor entered the block or card hovered).
   * Use this to scroll a custom sidebar card into view, animate a panel open, etc.
   */
  onFocus?: (blockId: string) => void;
  /**
   * Called when a block loses active status.
   * The blockId is the one that was previously active.
   */
  onBlur?: (blockId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function deriveCard(
  block: AiSuggestionBlock,
  isStale: boolean,
  isActive: boolean,
  isHovered: boolean,
): AiSuggestionCardData {
  const hasInsert = block.ops.some((o: AiOp) => o.type === "insert");
  const hasDelete = block.ops.some((o: AiOp) => o.type === "delete");

  let autoLabel: string;
  let kind: AiSuggestionCardData["kind"];

  if (hasInsert && hasDelete) {
    kind = "rewrite";
    autoLabel = truncate(block.acceptedText.trim(), 36) || "Rewrite";
  } else if (hasInsert) {
    kind = "insert";
    const text = block.ops
      .filter((o: AiOp) => o.type === "insert")
      .map((o: AiOp) => o.text)
      .join(" ")
      .trim();
    autoLabel = `+ ${truncate(text, 32)}`;
  } else {
    kind = "delete";
    autoLabel = truncate(block.acceptedText.trim(), 36) || "Removal";
  }

  // Prefer authored summary as the display label — it's more meaningful to users.
  const label = block.summary ? truncate(block.summary, 40) : autoLabel;

  return {
    blockId: block.nodeId,
    block,
    label,
    summary: block.summary,
    kind,
    isStale,
    isActive,
    isHovered,
  };
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to AI suggestion card data. The callback is called immediately
 * with the current state, then again whenever the plugin state changes.
 *
 * Performance: uses ProseMirror object-identity to skip rebuilding card data
 * when only unrelated state (typing, cursor blink, scroll) changes. The
 * callback fires only when suggestion, stale set, hover, or active block
 * actually changes.
 *
 * @param editor   The editor instance.
 * @param callback Called with current card list + action functions on each change.
 * @param options  Optional focus/blur transition callbacks.
 * @returns        Unsubscribe function.
 */
export function subscribeToAiSuggestions(
  editor: IEditor,
  callback: (
    cards: AiSuggestionCardData[],
    actions: AiSuggestionCardActions,
  ) => void,
  options?: AiSuggestionSubscribeOptions,
): () => void {
  const { onFocus, onBlur } = options ?? {};

  const actions: AiSuggestionCardActions = {
    accept(blockId, mode = "tracked") {
      applyAiSuggestion(editor, { blockId, mode });
    },
    reject(blockId) {
      rejectAiSuggestion(editor, { blockId });
    },
    acceptAll(mode = "tracked") {
      applyAiSuggestion(editor, { mode });
    },
    rejectAll() {
      rejectAiSuggestion(editor);
    },
    hover(blockId) {
      editor._applyTransaction(
        editor
          .getState()
          .tr.setMeta(AI_SUGGESTION_SET_HOVER, blockId)
          .setMeta("addToHistory", false),
      );
    },
    activate(blockId) {
      const found = findNodeById(editor.getState().doc, blockId);
      if (found) editor.selection.moveCursorTo(found.pos + 1);
    },
  };

  // ProseMirror returns the same plugin-state object reference when nothing in
  // the plugin changed. Track it so we skip callback on unrelated transactions
  // (every keypress, cursor blink, scroll) — no card rebuild, no React re-render.
  let prevPs: AiSuggestionPluginState | null | undefined = undefined;
  let prevActiveId: string | null = null;

  function emit() {
    const state = editor.getState();
    const ps = aiSuggestionPluginKey.getState(state);
    if (ps === prevPs) return;
    prevPs = ps;

    // ── Focus / blur transition detection ─────────────────────────────────
    const newActiveId = ps?.activeBlockId ?? null;
    if (newActiveId !== prevActiveId) {
      if (prevActiveId !== null) onBlur?.(prevActiveId);
      if (newActiveId !== null) onFocus?.(newActiveId);
      prevActiveId = newActiveId;
    }

    if (!ps?.suggestion) {
      callback([], actions);
      return;
    }

    const cards = ps.suggestion.blocks.map((block) =>
      deriveCard(
        block,
        ps.staleBlockIds.has(block.nodeId),
        ps.activeBlockId === block.nodeId,
        ps.hoverBlockId === block.nodeId,
      ),
    );

    callback(cards, actions);
  }

  const unsub = editor.subscribe(emit);
  emit(); // fire immediately with current state

  return unsub;
}
