import type { IEditor } from "@scrivr/core";

import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { CHANGE_OPERATION, CHANGE_STATUS } from "./types";

export interface ChangePopoverInfo {
  id: string;
  operation: CHANGE_OPERATION;
  authorID: string;
  status: CHANGE_STATUS;
  from: number;
  to: number;
  /** The actual text content involved in this change (preview for the UI). */
  text: string;
  /**
   * True when two or more authors' marks overlap this segment.
   * When true, `conflictChanges` contains all parties so the UI can render
   * per-author accept/reject controls.
   */
  isConflict: boolean;
  /** All pending changes that overlap this conflict range. Empty for normal changes. */
  conflictChanges: ChangePopoverInfo[];
  /**
   * All change IDs that belong to the same logical group (shared groupId).
   * Equal to [id] for ungrouped changes.
   * Pass this to setChangeStatuses to accept/reject the whole replacement atomically.
   */
  groupIds: string[];
  /**
   * For replacement groups: the full original text being removed.
   * Undefined for pure insertions or standalone deletions.
   */
  replacedText?: string;
  /**
   * For replacement groups: the full new text being inserted.
   * Undefined for pure deletions or standalone insertions.
   */
  insertedText?: string;
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
 * When isConflict is true, info.conflictChanges contains ALL parties whose
 * marks overlap the conflict range (not just those at the cursor position),
 * so the UI can show per-author previews and accept/reject buttons.
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
    const pending = changes.filter(c => c.dataTracked.status === CHANGE_STATUS.pending);

    // Primary: first pending change whose range contains the cursor
    const primary = pending.find(c => head >= c.from && head <= c.to);

    if (!primary) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const rect = editor.getViewportRect(primary.from, primary.to);
    if (!rect) {
      if (visible) { visible = false; lastKey = null; onHide(); }
      return;
    }

    const primaryIsConflict = !!(primary.dataTracked as { isConflict?: boolean }).isConflict;

    // When the primary change is flagged as a conflict, collect ALL pending
    // changes that overlap its range — not just those at the cursor.
    // This ensures both parties are always shown (e.g. user's deletion at
    // [4,11] and AI's insertion at [4,4] share the conflict range).
    let conflictGroup: typeof pending = [];
    let isConflict = false;

    if (primaryIsConflict) {
      conflictGroup = pending.filter(
        c => c.from <= primary.to && c.to >= primary.from,
      );
      isConflict = conflictGroup.length > 1 || primaryIsConflict;
    } else {
      // Check if multiple pending changes overlap the cursor (non-flagged overlap).
      // Only treat as a conflict when different authors have opposing operations
      // (insert vs delete). Same-author overlaps or same-operation overlaps are
      // normal multi-author coexistence, not conflicts.
      const atCursor = pending.filter(c => head >= c.from && head <= c.to);
      if (atCursor.length > 1) {
        const uniqueAuthors = new Set(atCursor.map(c => c.dataTracked.authorID));
        const ops = new Set(atCursor.map(c => c.dataTracked.operation));
        const hasOpposingOps =
          ops.has(CHANGE_OPERATION.insert) && ops.has(CHANGE_OPERATION.delete);
        if (uniqueAuthors.size > 1 && hasOpposingOps) {
          conflictGroup = atCursor;
          isConflict = true;
        }
      }
    }

    const readText = (from: number, to: number): string => {
      if (from >= to) return "";
      try { return state.doc.textBetween(from, to, " "); } catch { return ""; }
    };

    // Build group information for the primary change.
    // When char-level expansion produces many 1-char marks sharing a groupId,
    // we aggregate them here so the popover shows the full replacement text
    // and accept/reject applies to the whole group atomically.
    const primaryGroupId = (primary.dataTracked as { groupId?: string }).groupId;
    let groupIds: string[] = [primary.id];
    let replacedText: string | undefined;
    let insertedText: string | undefined;

    if (primaryGroupId) {
      const groupChanges = pending.filter(
        c => (c.dataTracked as { groupId?: string }).groupId === primaryGroupId,
      );
      groupIds = groupChanges.map(c => c.id);

      const deletes = groupChanges
        .filter(c => c.dataTracked.operation === CHANGE_OPERATION.delete)
        .sort((a, b) => a.from - b.from);
      const inserts = groupChanges
        .filter(c => c.dataTracked.operation === CHANGE_OPERATION.insert)
        .sort((a, b) => a.from - b.from);

      if (deletes.length > 0) {
        const dFrom = deletes[0]!.from;
        const dTo   = deletes[deletes.length - 1]!.to;
        replacedText = readText(dFrom, dTo);
      }
      if (inserts.length > 0) {
        const iFrom = inserts[0]!.from;
        const iTo   = inserts[inserts.length - 1]!.to;
        insertedText = readText(iFrom, iTo);
      }
    }

    const toInfo = (c: typeof primary): ChangePopoverInfo => ({
      id:              c.id,
      operation:       c.dataTracked.operation as CHANGE_OPERATION,
      authorID:        c.dataTracked.authorID ?? "unknown",
      status:          c.dataTracked.status as CHANGE_STATUS,
      from:            c.from,
      to:              c.to,
      text:            readText(c.from, c.to),
      isConflict:      !!(c.dataTracked as { isConflict?: boolean }).isConflict,
      conflictChanges: [],
      groupIds,
      ...(replacedText !== undefined ? { replacedText } : {}),
      ...(insertedText !== undefined ? { insertedText } : {}),
    });

    const primaryInfo = toInfo(primary);
    primaryInfo.isConflict = isConflict;
    primaryInfo.conflictChanges = isConflict ? conflictGroup.map(toInfo) : [];

    // Stable key: use groupId when available (so moving across chars within the
    // same replacement group doesn't re-trigger onShow), or sorted ids for conflicts.
    const key = isConflict
      ? conflictGroup.map(c => c.id).sort().join("|")
      : (primaryGroupId ?? primary.id);

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
