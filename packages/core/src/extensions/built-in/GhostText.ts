import { Plugin, PluginKey } from "prosemirror-state";
import { Extension } from "../Extension";
import type { IEditor, OverlayRenderHandler } from "../types";
import { findNodeById } from "./UniqueId";
import { renderGhostText } from "../../renderer/OverlayRenderer";

// ── Plugin state ──────────────────────────────────────────────────────────────

export interface GhostTextState {
  /** nodeId of the anchor block — ghost text appears after this node */
  nodeId: string | null;
  /** Accumulated text to display (grows during streaming) */
  content: string;
}

export const ghostTextPluginKey = new PluginKey<GhostTextState>("ghostText");

// ── Extension ─────────────────────────────────────────────────────────────────

/**
 * GhostText — renders cosmetic "ghost" text on the canvas overlay during AI
 * streaming. The document is not modified; this is pure visual feedback.
 *
 * The ghost text is drawn below the anchor block (identified by nodeId) in
 * italic muted style. It is cleared when nodeId is set to null.
 *
 * Commands:
 *   setGhostText(nodeId, content)  — show/update ghost text for a block
 *   clearGhostText()               — hide ghost text
 *
 * Usage:
 *   editor.commands.setGhostText("node-abc123", "AI is writing…")
 */
export const GhostText = Extension.create({
  name: "ghostText",

  addProseMirrorPlugins() {
    return [
      new Plugin<GhostTextState>({
        key: ghostTextPluginKey,
        state: {
          init: () => ({ nodeId: null, content: "" }),
          apply(tr, val) {
            const meta = tr.getMeta(ghostTextPluginKey) as GhostTextState | undefined;
            return meta !== undefined ? meta : val;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setGhostText:
        (nodeId: unknown, content: unknown) =>
        (state: import("prosemirror-state").EditorState, dispatch: ((tr: import("prosemirror-state").Transaction) => void) | undefined) => {
          if (dispatch) {
            const tr = state.tr.setMeta(ghostTextPluginKey, {
              nodeId:  nodeId  as string,
              content: content as string,
            });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },

      clearGhostText:
        () =>
        (state: import("prosemirror-state").EditorState, dispatch: ((tr: import("prosemirror-state").Transaction) => void) | undefined) => {
          if (dispatch) {
            const tr = state.tr.setMeta(ghostTextPluginKey, { nodeId: null, content: "" });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  onEditorReady(editor: IEditor) {
    const handler: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, charMap) => {
      const pluginState = ghostTextPluginKey.getState(editor.getState());
      if (!pluginState?.nodeId || !pluginState.content) return;

      const found = findNodeById(editor.getState().doc, pluginState.nodeId);
      if (!found) return;

      // Get the last position inside the block (just before the closing token)
      const lastPos = found.pos + found.node.nodeSize - 1;

      // Find all lines for this block to get layout metrics
      const blockFrom = found.pos + 1;
      const lines = charMap.linesInRange(blockFrom, lastPos)
        .filter((l) => l.page === pageNumber);

      if (lines.length === 0) return;

      const lastLine = lines[lines.length - 1]!;

      // Draw below the last line of the block
      const ghostY = lastLine.y + lastLine.height;
      const ghostX = lastLine.x;
      const maxW   = lastLine.contentWidth;

      // Use same font size as the last line's approx height
      const fontSize = Math.min(14, lastLine.height - 2);

      renderGhostText(ctx, pluginState.content, ghostX, ghostY, maxW, lastLine.height, {
        fontSize,
      });
    };

    const unregister = editor.addOverlayRenderHandler(handler);
    return unregister;
  },
});
