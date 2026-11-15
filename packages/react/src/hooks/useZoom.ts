import { useCallback, useSyncExternalStore } from "react";
import type { Editor, ZoomRequest } from "@scrivr/core";

function useZoomSnapshot<T>(editor: Editor | null, read: (editor: Editor) => T, fallback: T): T {
  const subscribe = useCallback((changed: () => void) => editor?.on("zoom", changed) ?? (() => {}), [editor]);
  const snapshot = () => (editor ? read(editor) : fallback);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The factor `editor` shows its document at — 1 is 100% — kept current as it
 * zooms: `setZoom`, a gesture, or a fit following its view. 1 while there is
 * no editor.
 */
export function useZoom(editor: Editor | null): number {
  return useZoomSnapshot(editor, (e) => e.zoom, 1);
}

/**
 * The zoom `editor` was asked for — a factor, or a fit — kept current. What a
 * zoom control shows as chosen: a fit that equals the factor it replaced
 * changes no factor, but it is still the fit that was chosen. 1 while there
 * is no editor.
 */
export function useZoomRequest(editor: Editor | null): ZoomRequest {
  return useZoomSnapshot(editor, (e) => e.zoomRequest, 1);
}
