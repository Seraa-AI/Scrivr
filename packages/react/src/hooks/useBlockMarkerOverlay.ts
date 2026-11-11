import { useEffect, useState } from "react";
import type { Editor } from "@scrivr/core";
import { createBlockMarkerOverlay } from "@scrivr/ai";
import type { PlacedBlockMarker } from "@scrivr/ai";
import { useFloatingPosition } from "./useFloatingPosition";

/**
 * Anchor whatever a host renders for the findings on the block the cursor is
 * in — a review's Pass, or a decision someone has to make.
 *
 * The markers are the ones on the innermost marked block, so a nested block's
 * finding anchors to that block rather than to an ancestor.
 */
export function useBlockMarkerOverlay(editor: Editor | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [markers, setMarkers] = useState<PlacedBlockMarker[]>([]);
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect, [markers]);

  useEffect(() => {
    if (!editor) return;
    return createBlockMarkerOverlay(editor, {
      onShow: (r, m) => {
        setRect(r);
        setMarkers(m);
      },
      onMove: (r, m) => {
        setRect(r);
        setMarkers(m);
      },
      onHide: () => {
        setRect(null);
        setMarkers([]);
      },
      getOverlayElement: () => ref.current,
    });
  }, [editor]);

  return {
    visible: !!rect && markers.length > 0,
    rect,
    markers,
    position,
    rootRef: ref,
  };
}
