/**
 * AiSuggestion.ts
 *
 * Extension that renders AI suggestion overlays on the canvas.
 *
 * Three visual states:
 *   Idle    — nothing. Zero canvas noise. Card panel signals the suggestion.
 *   Active  — indigo left-border stripe in margin + very faint tint + red
 *             dashed underlines on deleted text. Triggered by cursor entering
 *             the block or hovering the sidebar card.
 *   Stale   — 0.35 opacity. Block changed since suggestion was set.
 *
 * renderMode option (configure at setup):
 *   "active-only" (default) — only the focused block renders on canvas.
 *   "all"                   — all blocks always render their diffs.
 *   "none"                  — no canvas rendering; app handles it entirely.
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

export type AiSuggestionRenderMode = "active-only" | "all" | "none";

export interface AiSuggestionOptions {
  /**
   * Controls how the canvas overlay renders suggestion markers.
   *
   * "active-only" (default) — only the block under the cursor (or hovered card)
   *   renders its diff marks. Idle blocks are invisible on canvas.
   *
   * "all" — every block always renders its full diff (stripe + underlines).
   *   Use this for a "show all tracked changes" style view.
   *
   * "none" — the extension registers no canvas rendering at all.
   *   Use this when the app handles all visual feedback itself.
   */
  renderMode: AiSuggestionRenderMode;
}

export const AiSuggestion = Extension.create<AiSuggestionOptions>({
  name: "aiSuggestion",

  defaultOptions: {
    renderMode: "active-only",
  },

  addProseMirrorPlugins() {
    return [aiSuggestionPlugin];
  },

  onEditorReady(editor: IEditor) {
    const cleanups: Array<() => void> = [];

    const { renderMode } = this.options;

    // "none" — app handles all rendering; skip registering a handler entirely.
    if (renderMode === "none") {
      return () => { for (const c of cleanups) c(); };
    }

    const handler: OverlayRenderHandler = (
      ctx,
      pageNumber,
      pageConfig,
      charMap,
    ) => {
      const ps = aiSuggestionPluginKey.getState(editor.getState());
      if (!ps?.suggestion) return;

      const state = editor.getState();

      for (const block of ps.suggestion.blocks) {
        const isActive =
          ps.activeBlockId === block.nodeId || ps.hoverBlockId === block.nodeId;

        // "active-only": idle blocks render nothing — sidebar card is the affordance.
        if (renderMode === "active-only" && !isActive) continue;

        const found = findNodeById(state.doc, block.nodeId);
        if (!found) continue;

        const isStale = ps.staleBlockIds.has(block.nodeId);

        const blockStart = found.pos + 1;
        const blockEnd   = found.pos + found.node.nodeSize - 1;
        const lines = charMap
          .linesInRange(blockStart, blockEnd)
          .filter((l) => l.page === pageNumber);

        if (lines.length === 0) continue;

        ctx.save();
        if (isStale) ctx.globalAlpha = 0.35;

        const top    = Math.min(...lines.map((l) => l.y));
        const bottom = Math.max(...lines.map((l) => l.y + l.height));

        // ── Indigo left-border stripe (Notion/Linear style) ────────────────
        const stripeX = pageConfig.margins.left - 5;
        ctx.strokeStyle = "rgba(99, 102, 241, 0.7)";
        ctx.lineWidth   = 2.5;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(stripeX, top + 3);
        ctx.lineTo(stripeX, bottom - 3);
        ctx.stroke();

        // ── Dashed red underlines for deleted text ─────────────────────────
        if (block.ops.some((op) => op.type === "delete")) {
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
