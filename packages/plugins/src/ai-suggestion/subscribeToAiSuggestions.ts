/**
 * subscribeToAiSuggestions.ts
 *
 * Framework-agnostic subscription for AI suggestion card data.
 * Works in vanilla JS, Vue, Svelte, or any other environment.
 *
 * Usage:
 *   const unsub = subscribeToAiSuggestions(editor, (cards, actions) => {
 *     renderMyUI(cards);
 *   });
 *   unsub(); // stop listening
 */

import type { IEditor } from "@scrivr/core";
import { aiSuggestionPluginKey, AI_SUGGESTION_SET_HOVER } from "./AiSuggestionPlugin";
import { applyAiSuggestion, rejectAiSuggestion } from "./showHideApply";
import type { AiSuggestionBlock, AiOp, AiSuggestionPluginState } from "./types";

// ── Public types ──────────────────────────────────────────────────────────────

/** Derived card data — ready to render in any UI framework. */
export interface AiSuggestionCardData {
  /** Stable node ID — use as React/Vue key. */
  blockId:     string;
  /** The raw block with ops — for custom diff rendering. */
  block:       AiSuggestionBlock;
  /** Short human-readable label (truncated accepted text or op text). */
  label:       string;
  /** Semantic color hint for the card border: "rewrite" | "insert" | "delete" */
  kind:        "rewrite" | "insert" | "delete";
  /** True when the document has changed since the suggestion was set. */
  isStale:     boolean;
  /** True when the cursor is inside this block. */
  isActive:    boolean;
  /** True when the block is being hovered in the sidebar (set via actions.hover). */
  isHovered:   boolean;
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

  let label: string;
  let kind: AiSuggestionCardData["kind"];

  if (hasInsert && hasDelete) {
    kind  = "rewrite";
    label = truncate(block.acceptedText.trim(), 36) || "Rewrite";
  } else if (hasInsert) {
    kind  = "insert";
    const text = block.ops.filter((o: AiOp) => o.type === "insert").map((o: AiOp) => o.text).join(" ").trim();
    label = `+ ${truncate(text, 32)}`;
  } else {
    kind  = "delete";
    label = truncate(block.acceptedText.trim(), 36) || "Removal";
  }

  return { blockId: block.nodeId, block, label, kind, isStale, isActive, isHovered };
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
 * Returns an unsubscribe function.
 */
export function subscribeToAiSuggestions(
  editor: IEditor,
  callback: (cards: AiSuggestionCardData[], actions: AiSuggestionCardActions) => void,
): () => void {
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
        editor.getState().tr
          .setMeta(AI_SUGGESTION_SET_HOVER, blockId)
          .setMeta("addToHistory", false),
      );
    },
    activate(blockId) {
      const state = editor.getState();
      let nodePos: number | null = null;
      state.doc.descendants((node, pos) => {
        if (node.attrs["nodeId"] === blockId) { nodePos = pos; return false; }
        return undefined;
      });
      if (nodePos !== null) {
        editor.moveCursorTo((nodePos as number) + 1);
      }
    },
  };

  // ProseMirror returns the same plugin-state object reference when nothing in
  // the plugin changed. Track it so we skip callback on unrelated transactions
  // (every keypress, cursor blink, scroll) — no card rebuild, no React re-render.
  let prevPs: AiSuggestionPluginState | null | undefined = undefined;

  function emit() {
    const state = editor.getState();
    const ps    = aiSuggestionPluginKey.getState(state);
    if (ps === prevPs) return;
    prevPs = ps;

    if (!ps?.suggestion) {
      callback([], actions);
      return;
    }

    const cards = ps.suggestion.blocks.map((block) =>
      deriveCard(
        block,
        ps.staleBlockIds.has(block.nodeId),
        ps.activeBlockId === block.nodeId,
        ps.hoverBlockId  === block.nodeId,
      ),
    );

    callback(cards, actions);
  }

  const unsub = editor.subscribe(emit);
  emit(); // fire immediately with current state

  return unsub;
}
