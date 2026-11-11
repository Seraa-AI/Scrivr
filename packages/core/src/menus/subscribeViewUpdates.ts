import type { IEditor } from "../extensions/types";

/**
 * Subscribes `fn` to state updates (doc/selection changes), viewport updates
 * (scroll, resize) and a change of the surface being edited. Returns an
 * unsubscribe function that detaches all three.
 *
 * Anchored popovers and menus use this because their anchor can move or go
 * without any state change: a scroll moves it, and starting to edit a header
 * leaves a body link's card nothing to anchor to until editing returns.
 */
export function subscribeViewUpdates(
  editor: IEditor,
  fn: () => void,
): () => void {
  const offUpdate = editor.on("update", fn);
  const offViewport = editor.on("viewport", fn);
  const offSurface = editor.surfaces.onSurfaceChange(() => fn());
  return () => {
    offUpdate();
    offViewport();
    offSurface();
  };
}
