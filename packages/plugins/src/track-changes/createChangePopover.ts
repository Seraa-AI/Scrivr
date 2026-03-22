import type { IEditor } from "@inscribe/core";

import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { CHANGE_OPERATION, CHANGE_STATUS } from "./types";

export interface ChangePopoverInfo {
  id: string;
  operation: CHANGE_OPERATION;
  authorID: string;
  status: CHANGE_STATUS;
  from: number;
  to: number;
  /**
   * True when two or more authors' marks overlap this exact segment.
   * When true, `conflictChanges` contains all overlapping changes so the UI
   * can render per-author accept/reject controls.
   */
  isConflict: boolean;
  /**
   * All pending changes that overlap the cursor position when isConflict is true.
   * Empty array for normal (non-conflict) changes.
   */
  conflictChanges: ChangePopoverInfo[];
}

export interface ChangePopoverCallbacks {
  onShow: (rect: DOMRect, info: ChangePopoverInfo) => void;
  onMove: (rect: DOMRect, info: ChangePopoverInfo) => void;
  onHide: () => void;
}

/**
 * createChangePopover — headless controller for an accept/reject popover.
 *
 * Subscribes to editor state changes and fires onShow/onMove/onHide whenever
 * the cursor lands inside a pending tracked change.
 *
 * When multiple authors' marks overlap (isConflict), info.conflictChanges
 * contains all overlapping changes so the UI can render a conflict popover
 * with per-author accept/reject buttons.
 *
 * @example
 *   const cleanup = createChangePopover(editor, {
 *     onShow: (rect, info) => { popover.style.display = "block"; ... },
 *     onMove: (rect, info) => { popover.style.top = rect.bottom + "px"; },
 *     onHide: () => { popover.style.display = "none"; },
 *   });
 */
export function createChangePopover(
  editor: IEditor,
  options: ChangePopoverCallbacks,
): () => void {
  const { onShow, onMove, onHide } = options;
  let visible = false;
  let lastKey: string | null = null;

  function update() {
    const state = editor.getState();
    const pluginState = trackChangesPluginKey.getState(state);
    if (!pluginState) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const { head } = state.selection;
    const { changes } = pluginState.changeSet;

    // All pending changes that contain the cursor
    const atCursor = changes.filter(
      c =>
        c.dataTracked.status === CHANGE_STATUS.pending &&
        head >= c.from &&
        head <= c.to,
    );

    if (atCursor.length === 0) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    // Primary change — the first one (determines the popover anchor rect)
    const primary = atCursor[0]!;
    const rect = editor.getViewportRect(primary.from, primary.to);
    if (!rect) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const isConflict = atCursor.length > 1 ||
      !!(primary.dataTracked as { isConflict?: boolean }).isConflict;

    // Build info objects for all changes at the cursor
    const toInfo = (c: typeof primary): ChangePopoverInfo => ({
      id:               c.id,
      operation:        c.dataTracked.operation as CHANGE_OPERATION,
      authorID:         c.dataTracked.authorID ?? "unknown",
      status:           c.dataTracked.status as CHANGE_STATUS,
      from:             c.from,
      to:               c.to,
      isConflict:       !!(c.dataTracked as { isConflict?: boolean }).isConflict,
      conflictChanges:  [],
    });

    const primaryInfo = toInfo(primary);
    primaryInfo.isConflict = isConflict;
    primaryInfo.conflictChanges = isConflict ? atCursor.map(toInfo) : [];

    // Stable key: sorted ids of all changes at cursor
    const key = atCursor.map(c => c.id).sort().join("|");

    if (visible && lastKey === key) {
      onMove(rect, primaryInfo);
    } else {
      visible = true;
      lastKey = key;
      onShow(rect, primaryInfo);
    }
  }

  const unsubscribe = editor.subscribe(update);

  return () => {
    unsubscribe();
    if (visible) { visible = false; lastKey = null; onHide(); }
  };
}
