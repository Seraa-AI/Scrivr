import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import { Extension, renderAiCaret } from "@scrivr/core";
import type { IEditor, OverlayRenderHandler } from "@scrivr/core";

// ── Plugin state ──────────────────────────────────────────────────────────────

export interface AiCaretState {
  /** Doc position where the AI caret is drawn. Null = hidden. */
  position: number | null;
}

export const aiCaretPluginKey = new PluginKey<AiCaretState>("aiCaret");

// ── Extension ─────────────────────────────────────────────────────────────────

/**
 * AiCaret — draws a visual caret with an "AI" label on the overlay canvas to
 * indicate where AI content is being generated. Purely cosmetic; no document
 * changes occur while the caret is visible.
 *
 * The caret position is automatically mapped through document changes so it
 * stays anchored even if the user edits elsewhere during generation.
 *
 * Commands:
 *   setAiCaret(position)  — show the caret at a doc position
 *   clearAiCaret()        — hide the caret
 *
 * Usage:
 *   editor.commands.setAiCaret(editor.getState().selection.from)
 */
export const AiCaret = Extension.create({
  name: "aiCaret",

  addProseMirrorPlugins() {
    return [
      new Plugin<AiCaretState>({
        key: aiCaretPluginKey,
        state: {
          init: () => ({ position: null }),
          apply(tr, val) {
            const meta = tr.getMeta(aiCaretPluginKey) as AiCaretState | undefined;
            if (meta !== undefined) return meta;

            // Keep the position mapped through document changes
            if (val.position !== null && tr.docChanged) {
              const result = tr.mapping.mapResult(val.position);
              return { position: result.deleted ? null : result.pos };
            }
            return val;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setAiCaret:
        (position: unknown) =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          if (dispatch) {
            const tr = state.tr.setMeta(aiCaretPluginKey, { position: position as number });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },

      clearAiCaret:
        () =>
        (state: EditorState, dispatch: ((tr: Transaction) => void) | undefined) => {
          if (dispatch) {
            const tr = state.tr.setMeta(aiCaretPluginKey, { position: null });
            tr.setMeta("addToHistory", false);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  onEditorReady(editor: IEditor) {
    // Blink state — toggles every 530 ms, same cadence as the user cursor
    let blinkVisible = true;
    let blinkTimer: ReturnType<typeof setInterval> | null = null;

    const startBlink = () => {
      if (blinkTimer !== null) return;
      blinkTimer = setInterval(() => {
        blinkVisible = !blinkVisible;
        editor.redraw();
      }, 530);
    };

    const stopBlink = () => {
      if (blinkTimer !== null) {
        clearInterval(blinkTimer);
        blinkTimer = null;
      }
      blinkVisible = true;
    };

    const handler: OverlayRenderHandler = (ctx, pageNumber, _pageConfig, charMap) => {
      const pluginState = aiCaretPluginKey.getState(editor.getState());

      if (pluginState?.position == null) {
        stopBlink();
        return;
      }

      startBlink();

      const coords = charMap.coordsAtPos(pluginState.position);
      if (!coords || coords.page !== pageNumber) return;

      renderAiCaret(ctx, coords, { visible: blinkVisible });
    };

    const unregister = editor.addOverlayRenderHandler(handler);

    return () => {
      stopBlink();
      unregister();
    };
  },
});
