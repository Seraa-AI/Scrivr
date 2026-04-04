import type { IEditor } from "@scrivr/core";

import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  NodeAttrChange,
  MarkChange,
} from "./types";

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
  /**
   * For node attribute changes (e.g. heading level, alignment): the node
   * attributes before the change was applied.
   */
  oldAttrs?: Record<string, any>;
  /**
   * For node attribute changes: the node attributes after the change was applied.
   */
  newAttrs?: Record<string, any>;
  /**
   * For move operations: the UUID that links the source deletion to this
   * destination insertion (or vice-versa). Use this to locate the paired change.
   */
  moveNodeId?: string;
  /**
   * For move operations: whether this end of the move is the source block
   * (content was cut from here) or the destination (content was pasted here).
   */
  moveRole?: "source" | "destination";
  /**
   * For mark changes (e.g. bold/italic applied or removed): the ProseMirror
   * mark type name, e.g. "bold", "italic", "underline".
   */
  markName?: string;
  /**
   * Discriminator for the change kind — mirrors TrackedChange.type without the
   * "-change" suffix. Lets UI components render the correct label and preview
   * without having to infer the kind from operation + markName + oldAttrs.
   *
   *   "text"      — inline text inserted or deleted
   *   "mark"      — formatting mark applied or removed (bold, italic, color…)
   *   "node-attr" — block attribute changed (heading level, alignment…)
   *   "node"      — whole block inserted or deleted
   *   "wrap"      — block wrapped in a container
   *   "reference" — reference annotation
   */
  changeKind: "text" | "mark" | "node-attr" | "node" | "wrap" | "reference";
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
      if (visible) {
        visible = false;
        lastKey = null;
        onHide();
      }
      return;
    }

    const { head } = state.selection;
    const { changes } = pluginState.changeSet;
    const pending = changes.filter(
      (c) => c.dataTracked.status === CHANGE_STATUS.pending,
    );

    // Primary: first pending change whose range contains the cursor
    const primary = pending.find((c) => head >= c.from && head <= c.to);

    if (!primary) {
      if (visible) {
        visible = false;
        lastKey = null;
        onHide();
      }
      return;
    }

    // Anchor to the cursor position, not the full change range.
    // A large change (whole paragraph, heading) would give a huge rect whose
    // top/bottom is far from where the cursor actually is.
    const rect = editor.getViewportRect(head, head);
    if (!rect) {
      if (visible) {
        visible = false;
        lastKey = null;
        onHide();
      }
      return;
    }

    const primaryIsConflict = !!(
      primary.dataTracked as { isConflict?: boolean }
    ).isConflict;

    // When the primary change is flagged as a conflict, collect ALL pending
    // changes that overlap its range — not just those at the cursor.
    // This ensures both parties are always shown (e.g. user's deletion at
    // [4,11] and AI's insertion at [4,4] share the conflict range).
    let conflictGroup: typeof pending = [];
    let isConflict = false;

    if (primaryIsConflict) {
      conflictGroup = pending.filter(
        (c) => c.from <= primary.to && c.to >= primary.from,
      );
      isConflict = conflictGroup.length > 1 || primaryIsConflict;
    } else {
      // Check if multiple pending changes overlap the cursor (non-flagged overlap).
      // Only treat as a conflict when different authors have opposing operations
      // (insert vs delete). Same-author overlaps or same-operation overlaps are
      // normal multi-author coexistence, not conflicts.
      const atCursor = pending.filter((c) => head >= c.from && head <= c.to);
      if (atCursor.length > 1) {
        const uniqueAuthors = new Set(
          atCursor.map((c) => c.dataTracked.authorID),
        );
        const ops = new Set(atCursor.map((c) => c.dataTracked.operation));
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
      try {
        return state.doc.textBetween(from, to, " ");
      } catch {
        return "";
      }
    };

    // Build group information for the primary change.
    // When char-level expansion produces many 1-char marks sharing a groupId,
    // we aggregate them here so the popover shows the full replacement text
    // and accept/reject applies to the whole group atomically.
    const primaryGroupId = (primary.dataTracked as { groupId?: string })
      .groupId;
    let groupIds: string[] = [primary.id];
    let replacedText: string | undefined;
    let insertedText: string | undefined;

    if (primaryGroupId) {
      const groupChanges = pending.filter(
        (c) =>
          (c.dataTracked as { groupId?: string }).groupId === primaryGroupId,
      );
      groupIds = groupChanges.map((c) => c.id);

      const deletes = groupChanges
        .filter((c) => c.dataTracked.operation === CHANGE_OPERATION.delete)
        .sort((a, b) => a.from - b.from);
      const inserts = groupChanges
        .filter((c) => c.dataTracked.operation === CHANGE_OPERATION.insert)
        .sort((a, b) => a.from - b.from);

      if (deletes.length > 0) {
        const dFrom = deletes[0]!.from;
        const dTo = deletes[deletes.length - 1]!.to;
        replacedText = readText(dFrom, dTo);
      }
      if (inserts.length > 0) {
        const iFrom = inserts[0]!.from;
        const iTo = inserts[inserts.length - 1]!.to;
        insertedText = readText(iFrom, iTo);
      }
    }

    const ATTR_LABELS: Record<string, string> = {
      level: "Heading level",
      align: "Alignment",
      fontFamily: "Font",
      fontSize: "Font size",
      indent: "Indent",
    };

    /** Human-readable value for a known attribute key. */
    const attrValueLabel = (key: string, val: unknown): string => {
      if (val == null) {
        if (key === "level") return "Paragraph";
        return "default";
      }
      if (key === "level") return `Heading ${val}`;
      if (key === "align") {
        const MAP: Record<string, string> = {
          left: "Left",
          center: "Center",
          right: "Right",
          justify: "Justify",
        };
        return MAP[String(val)] ?? String(val);
      }
      return String(val);
    };

    const toInfo = (c: typeof primary): ChangePopoverInfo => {
      const op = c.dataTracked.operation as CHANGE_OPERATION;

      // ── Change kind ─────────────────────────────────────────────────────────
      const changeKind: ChangePopoverInfo["changeKind"] =
        c.type === "mark-change"
          ? "mark"
          : c.type === "node-attr-change"
            ? "node-attr"
            : c.type === "node-change"
              ? "node"
              : c.type === "wrap-change"
                ? "wrap"
                : c.type === "reference-change"
                  ? "reference"
                  : "text";

      // ── Attribute change fields ──────────────────────────────────────────────
      let oldAttrs: Record<string, any> | undefined;
      let newAttrs: Record<string, any> | undefined;
      if (op === CHANGE_OPERATION.set_node_attributes) {
        const attrChange = c as NodeAttrChange;
        oldAttrs = attrChange.oldAttrs;
        newAttrs = attrChange.newAttrs;
      }

      // ── Move operation fields ────────────────────────────────────────────────
      const moveNodeId = (c.dataTracked as { moveNodeId?: string }).moveNodeId;
      let moveRole: "source" | "destination" | undefined;
      if (moveNodeId) {
        moveRole = op === CHANGE_OPERATION.delete ? "source" : "destination";
      }

      // ── Mark change fields ───────────────────────────────────────────────────
      let markName: string | undefined;
      if (c.type === "mark-change") {
        markName = (c as MarkChange).mark.type.name;
      }

      // ── Text preview — kind-aware ────────────────────────────────────────────
      // For node-attr changes, show the attr diff instead of raw node text.
      // For mark changes, show the affected text.
      // For all others, read the document text between from/to.
      let text: string;
      if (changeKind === "node-attr" && oldAttrs && newAttrs) {
        const parts: string[] = [];
        const keys = new Set([
          ...Object.keys(oldAttrs),
          ...Object.keys(newAttrs),
        ]);
        for (const key of keys) {
          if (key === "nodeId" || key === "dataTracked") continue;
          if (oldAttrs[key] !== newAttrs[key]) {
            const label = ATTR_LABELS[key] ?? key;
            const from = attrValueLabel(key, oldAttrs[key]);
            const to = attrValueLabel(key, newAttrs[key]);
            parts.push(`${label}: ${from} → ${to}`);
          }
        }
        // Empty string when no meaningful attrs differ — the popover will show
        // the "Style changed" badge without a misleading preview row.
        text = parts.join(" · ");
      } else {
        text = readText(c.from, c.to);
      }

      return {
        id: c.id,
        operation: op,
        authorID: c.dataTracked.authorID ?? "unknown",
        status: c.dataTracked.status as CHANGE_STATUS,
        from: c.from,
        to: c.to,
        text,
        isConflict: !!(c.dataTracked as { isConflict?: boolean }).isConflict,
        conflictChanges: [],
        groupIds,
        changeKind,
        ...(replacedText !== undefined ? { replacedText } : {}),
        ...(insertedText !== undefined ? { insertedText } : {}),
        ...(oldAttrs !== undefined ? { oldAttrs } : {}),
        ...(newAttrs !== undefined ? { newAttrs } : {}),
        ...(moveNodeId !== undefined ? { moveNodeId } : {}),
        ...(moveRole !== undefined ? { moveRole } : {}),
        ...(markName !== undefined ? { markName } : {}),
      };
    };

    const primaryInfo = toInfo(primary);
    primaryInfo.isConflict = isConflict;
    primaryInfo.conflictChanges = isConflict ? conflictGroup.map(toInfo) : [];

    // Stable key: use groupId when available (so moving across chars within the
    // same replacement group doesn't re-trigger onShow), or sorted ids for conflicts.
    const key = isConflict
      ? conflictGroup
          .map((c) => c.id)
          .sort()
          .join("|")
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
    if (visible) {
      visible = false;
      lastKey = null;
      onHide();
    }
  };
}
