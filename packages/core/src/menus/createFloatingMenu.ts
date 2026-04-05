/**
 * createFloatingMenu — framework-agnostic controller for a floating block menu.
 *
 * Shows when the cursor is in an empty text block (nothing selected, nothing
 * typed). Intended for block-insertion UX: a "+" button or slash-command
 * trigger that appears beside empty paragraphs.
 *
 * @example — vanilla JS
 *   const el = document.getElementById("floating-menu");
 *   const cleanup = createFloatingMenu(editor, {
 *     onShow: (rect) => { el.style.cssText = `display:block;left:${rect.left - 32}px;top:${rect.top}px` },
 *     onHide: ()     => { el.style.display = "none" },
 *   });
 */
import type { IEditor } from "../extensions/types";
import type { EditorState } from "prosemirror-state";

export interface FloatingMenuCallbacks {
  onShow: (rect: DOMRect) => void;
  onHide: () => void;
  onMove: (rect: DOMRect) => void;
}

export interface FloatingMenuOptions extends FloatingMenuCallbacks {
  /**
   * Override visibility logic.
   * Default: show when cursor is in an empty root-level text block.
   */
  shouldShow?: (state: EditorState) => boolean;
}

export function createFloatingMenu(editor: IEditor, options: FloatingMenuOptions): () => void {
  const { onShow, onHide, onMove } = options;
  const shouldShow = options.shouldShow ?? defaultShouldShow;

  let visible = false;
  let rafId: number | null = null;

  function update() {
    const state = editor.getState();
    const show  = shouldShow(state);

    if (!show) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    const { from } = state.selection;
    const rect = editor.getViewportRect(from, from);
    if (!rect) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    if (visible) {
      onMove(rect);
    } else {
      visible = true;
      onShow(rect);
    }
  }

  const unsubscribe = editor.on("update", () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  });

  return () => {
    unsubscribe();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (visible) { visible = false; onHide(); }
  };
}

function defaultShouldShow(state: EditorState): boolean {
  const { selection } = state;
  const { empty, $anchor } = selection;
  if (!empty) return false;

  // Must be a text block (paragraph, heading) at root depth
  const isRootTextBlock = $anchor.depth === 1 && $anchor.parent.isTextblock;
  if (!isRootTextBlock) return false;

  // Block must be empty
  return $anchor.parent.textContent === "";
}
