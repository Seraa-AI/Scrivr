import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@scrivr/core";

/**
 * The factor `editor` shows its document at — 1 is 100% — kept current as it
 * zooms: `setZoom`, a gesture, or a fit following its view. 1 while there is
 * no editor.
 */
export function useZoom(editor: Editor | null): number {
  const subscribe = useCallback((changed: () => void) => editor?.on("zoom", changed) ?? (() => {}), [editor]);
  const zoom = () => editor?.zoom ?? 1;
  return useSyncExternalStore(subscribe, zoom, zoom);
}
