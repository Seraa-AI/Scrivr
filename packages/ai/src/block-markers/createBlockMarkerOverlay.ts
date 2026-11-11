/**
 * Headless controller for whatever a host paints at a marked block.
 *
 * The same show / move / hide lifecycle `createSuggestionPopover` gives a
 * suggestion group, against the block's own rect — a finding that proposes no
 * edit still has to be anchored where the reader is looking.
 */
import type { IEditor } from "@scrivr/core";
import {
  subscribeViewUpdates,
  subscribeEditorFocusOutside,
  isAnchorInsideContainer,
} from "@scrivr/core";

import { activeBlockMarkerAnchor } from "./markers";
import type { PlacedBlockMarker } from "./types";

export interface BlockMarkerOverlayCallbacks {
  onShow: (rect: DOMRect, markers: PlacedBlockMarker[]) => void;
  onMove: (rect: DOMRect, markers: PlacedBlockMarker[]) => void;
  onHide: () => void;
  /**
   * The overlay's own root element, if it has one. Clicks into it must not
   * read as focus leaving the editor — see `createSuggestionPopover`.
   */
  getOverlayElement?: () => HTMLElement | null;
}

/**
 * @returns a cleanup function — call it when the host unmounts.
 */
export function createBlockMarkerOverlay(
  editor: IEditor,
  callbacks: BlockMarkerOverlayCallbacks,
): () => void {
  const { onShow, onMove, onHide, getOverlayElement } = callbacks;
  let visible = false;
  let lastKey: string | null = null;

  const hide = () => {
    if (!visible) return;
    visible = false;
    lastKey = null;
    onHide();
  };

  function update() {
    const anchor = activeBlockMarkerAnchor(editor);
    if (!anchor) return hide();

    // One block, so one rect — the markers all name it, and the host decides
    // how to stack them.
    const { markers: active, node, pos } = anchor;
    const rect = editor.getViewportRect(pos, pos + node.nodeSize);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      return hide();
    }

    const key = active.map((m) => `${m.source}:${m.nodeId}:${m.kind}`).join("|");
    if (visible && lastKey === key) {
      onMove(rect, active);
    } else {
      visible = true;
      lastKey = key;
      onShow(rect, active);
    }
  }

  const offState = editor.subscribe(update);
  const offView = subscribeViewUpdates(editor, update);
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    hide,
    getOverlayElement ? { getPopoverElement: getOverlayElement } : {},
  );

  return () => {
    offState();
    offView();
    offFocusOutside();
    hide();
  };
}
