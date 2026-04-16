import type { IEditor } from "../extensions/types";

/**
 * Subscribes `fn` to BOTH state updates (doc/selection changes) AND viewport
 * updates (scroll, resize). Returns an unsubscribe function that detaches
 * both listeners.
 *
 * Anchored popovers and menus use this because a viewport-space anchor moves
 * on scroll without any state change — listening to `"update"` alone leaves
 * them stuck at their last paint position until the next transaction fires.
 */
export function subscribeViewUpdates(
  editor: IEditor,
  fn: () => void,
): () => void {
  const offUpdate = editor.on("update", fn);
  const offViewport = editor.on("viewport", fn);
  return () => {
    offUpdate();
    offViewport();
  };
}
