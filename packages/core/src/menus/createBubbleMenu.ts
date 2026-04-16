/**
 * createBubbleMenu — framework-agnostic controller for a selection bubble menu.
 *
 * Shows when the editor has a non-empty text selection.
 * The caller is responsible for rendering — this controller just calls
 * onShow/onHide/onMove with a viewport DOMRect.
 *
 * @example — vanilla JS
 *   const el = document.getElementById("bubble-menu");
 *   const cleanup = createBubbleMenu(editor, {
 *     onShow: (rect) => { el.style.cssText = `display:block;left:${rect.left}px;top:${rect.top - 40}px` },
 *     onHide: ()     => { el.style.display = "none" },
 *   });
 *   // later: cleanup()
 */
import type { IEditor } from "../extensions/types";
import type { EditorState } from "prosemirror-state";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { isAnchorInsideContainer } from "./anchorVisibility";

export interface BubbleMenuCallbacks {
  /** Called when the menu should become visible. `rect` is the selection's viewport DOMRect. */
  onShow: (rect: DOMRect) => void;
  /** Called when the menu should hide. */
  onHide: () => void;
  /** Called when the menu is already visible but the rect changed (selection moved). */
  onMove: (rect: DOMRect) => void;
}

export interface BubbleMenuOptions extends BubbleMenuCallbacks {
  /**
   * Override visibility logic. Return true to show, false to hide.
   * Default: show when there is a non-empty text selection.
   */
  shouldShow?: (state: EditorState) => boolean;
  /**
   * Debounce delay in ms. Prevents flickering when the selection changes
   * rapidly (e.g. during drag-select). Default: 80.
   */
  debounce?: number;
}

export function createBubbleMenu(editor: IEditor, options: BubbleMenuOptions): () => void {
  const { onShow, onHide, onMove, debounce: delay = 80 } = options;

  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const shouldShow = options.shouldShow ?? defaultShouldShow;

  function update() {
    const state = editor.getState();
    const show  = shouldShow(state);

    if (!show) {
      if (visible) { visible = false; onHide(); }
      return;
    }

    const { from, to } = state.selection;
    const rect = editor.getViewportRect(from, to);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
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

  function scheduleUpdate() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, delay);
  }

  const unsubscribe = subscribeViewUpdates(editor, scheduleUpdate);

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    if (visible) { visible = false; onHide(); }
  };
}

function defaultShouldShow(state: EditorState): boolean {
  const { selection, doc } = state;
  const { empty, from, to } = selection;
  if (empty) return false;
  // Confirm there is actual text in the selection (not just a node selection)
  return doc.textBetween(from, to).length > 0;
}
