/**
 * AiSuggestion.ts
 *
 * Extension that renders AI suggestion overlays on the canvas.
 *
 * Three visual states:
 *   Idle    — very soft indigo tint. No diff detail. Signals "suggestion here".
 *   Active  — stronger tint + dashed red underlines on deleted text.
 *             Triggered by cursor entering the block or hovering the card.
 *   Stale   — 0.35 opacity. Block changed since suggestion was set.
 *
 * Design intent: show diffs only when the user is focused on that block.
 * The tint alone is enough to indicate pending suggestions at a glance.
 */

import { Extension } from "@scrivr/core";
import type { IEditor, OverlayRenderHandler } from "@scrivr/core";

import { findNodeById } from "../ai-toolkit/UniqueId";
import { buildAcceptedTextMap } from "../track-changes/lib/acceptedTextMap";

import {
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET_ACTIVE,
  aiSuggestionPlugin,
} from "./AiSuggestionPlugin";
import {
  buildOpRenderInstructions,
  renderInstructions,
} from "./renderAiSuggestionOps";

export const AiSuggestion = Extension.create({
  name: "aiSuggestion",

  addProseMirrorPlugins() {
    return [aiSuggestionPlugin];
  },

  onEditorReady(editor: IEditor) {
    const cleanups: Array<() => void> = [];

    const handler: OverlayRenderHandler = (
      ctx,
      pageNumber,
      _pageConfig,
      charMap,
    ) => {
      const ps = aiSuggestionPluginKey.getState(editor.getState());
      if (!ps?.suggestion) return;

      const state = editor.getState();

      for (const block of ps.suggestion.blocks) {
        const found = findNodeById(state.doc, block.nodeId);
        if (!found) continue;

        const isActive =
          ps.activeBlockId === block.nodeId || ps.hoverBlockId === block.nodeId;
        const isStale = ps.staleBlockIds.has(block.nodeId);

        // Gather lines for this block on the current page — needed for both
        // the background tint (all blocks) and the diff underlines (active only).
        const blockStart = found.pos + 1;
        const blockEnd   = found.pos + found.node.nodeSize - 1;
        const lines = charMap
          .linesInRange(blockStart, blockEnd)
          .filter((l) => l.page === pageNumber);

        if (lines.length === 0) continue;

        ctx.save();
        if (isStale) ctx.globalAlpha = 0.35;

        // ── Background tint ────────────────────────────────────────────────
        // Idle:   very soft indigo — signals "suggestion here", no diff detail.
        // Active: stronger tint — signals "I am working on this block".
        ctx.fillStyle = isActive
          ? "rgba(99, 102, 241, 0.09)"  // indigo, visible
          : "rgba(99, 102, 241, 0.04)"; // indigo, barely-there

        for (const line of lines) {
          ctx.fillRect(line.x, line.y, line.contentWidth, line.height);
        }

        // ── Diff underlines (active only) ──────────────────────────────────
        // Show delete markers only when the user is focused on this block.
        // Inactive blocks never show red lines — the tint alone is enough.
        if (isActive && block.ops.some((op) => op.type === "delete")) {
          const { map } = buildAcceptedTextMap(
            found.node,
            found.pos,
            state.schema,
          );

          const instructions = buildOpRenderInstructions(
            block.ops,
            map,
            charMap,
            pageNumber,
          );

          renderInstructions(ctx, instructions, charMap, isActive);
        }

        ctx.restore();
      }
    };

    const unregister = editor.addOverlayRenderHandler(handler);
    cleanups.push(unregister);

    // Track cursor → keep activeBlockId in sync.
    // Guard: skip when cursor hasn't moved (most state changes don't move it).
    let prevHead = -1;
    const unsubActive = editor.subscribe(() => {
      const state = editor.getState();
      const ps = aiSuggestionPluginKey.getState(state);
      if (!ps?.suggestion) return;

      const { head } = state.selection;
      if (head === prevHead) return;
      prevHead = head;

      let newActive: string | null = null;

      for (const block of ps.suggestion.blocks) {
        const found = findNodeById(state.doc, block.nodeId);
        if (!found) continue;
        if (head >= found.pos && head <= found.pos + found.node.nodeSize) {
          newActive = block.nodeId;
          break;
        }
      }

      if (ps.activeBlockId !== newActive) {
        editor._applyTransaction(
          state.tr
            .setMeta(AI_SUGGESTION_SET_ACTIVE, newActive)
            .setMeta("addToHistory", false),
        );
      }
    });
    cleanups.push(unsubActive);

    return () => {
      for (const c of cleanups) c();
    };
  },
});
