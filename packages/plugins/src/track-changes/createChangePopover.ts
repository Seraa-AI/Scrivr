import type { IEditor } from "@scrivr/core";
import { subscribeViewUpdates, subscribeEditorFocusOutside, isAnchorInsideContainer } from "@scrivr/core";
import type { Node as PMNode } from "@scrivr/core/pm";

import { trackChangesPluginKey } from "./engine/trackChangesPlugin";
import { describeAttrChanges } from "./attrChanges";
import { changeActs } from "./reviewPlan";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
} from "./types";
import type { TrackedChange } from "./types";

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
   * For node type changes (e.g. bulletList → orderedList): the old node type name.
   * Undefined for pure attribute changes where the node type stays the same.
   */
  oldNodeTypeName?: string;
  /**
   * For node type changes: the new node type name.
   */
  newNodeTypeName?: string;
  /**
   * For move operations: the UUID that links the source deletion to this
   * destination insertion (or vice-versa). Use this to locate the paired change.
   */
  moveNodeId?: string;
  /** The move this text is half of, when it was moved rather than written or removed. */
  moveId?: string;
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
  /**
   * The block a "node" or "node-attr" change is on — "listItem", "paragraph",
   * "image", "tableRow" — so a UI can say what was added, removed or changed,
   * not only that a block was.
   */
  nodeTypeName?: string;
}

export interface ChangePopoverCallbacks {
  onShow: (rect: DOMRect, info: ChangePopoverInfo) => void;
  onMove: (rect: DOMRect, info: ChangePopoverInfo) => void;
  onHide: () => void;
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Used by the focus-outside check so clicks INTO the popover (Accept /
   * Reject buttons) don't trigger an immediate hide.
   */
  getPopoverElement?: () => HTMLElement | null;
}

/**
 * The change a popover offers at the caret: the act that owns the innermost
 * pending record there, shown by that act's primary. Inside a row someone
 * added, that is the row — its words are part of adding it — while an edit
 * someone else made inside the row is its own act and shows as itself.
 */
export function changeAtCaret(pending: readonly TrackedChange[], head: number): TrackedChange | undefined {
  const atCaret = pending.filter((c) => head >= c.from && head <= c.to);
  const innermost = atCaret.reduce<TrackedChange | undefined>(
    (best, c) => (!best || c.to - c.from < best.to - best.from ? c : best),
    undefined,
  );
  if (!innermost) return undefined;
  return changeActs(pending).find((act) => act.records.includes(innermost))?.primary ?? innermost;
}

/**
 * A block change as the block will read: one moved or added without the words
 * proposed for deletion inside it, one removed without the words proposed for
 * insertion. A move reads from where it went, whichever half is given. Blocks,
 * such as the cells of a row, are joined by " · ".
 */
export function changePreviewText(doc: PMNode, change: TrackedChange, pending: readonly TrackedChange[]): string {
  const { moveNodeId } = change.dataTracked;
  const copy = moveNodeId
    ? pending.find((o) => o.dataTracked.moveNodeId === moveNodeId && o.dataTracked.operation === CHANGE_OPERATION.move)
    : undefined;
  return copy
    ? blockPreviewText(doc, copy.from, copy.to, false)
    : blockPreviewText(doc, change.from, change.to, change.dataTracked.operation === CHANGE_OPERATION.delete);
}

function blockPreviewText(doc: PMNode, from: number, to: number, removed: boolean): string {
  const left = removed ? "trackedInsert" : "trackedDelete";
  const blocks: string[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) blocks.push("");
    if (!node.isText || node.marks.some((mark) => mark.type.name === left)) return true;
    const text = node.text ?? "";
    const start = Math.max(from, pos) - pos;
    const end = Math.min(to, pos + text.length) - pos;
    if (blocks.length === 0) blocks.push("");
    blocks[blocks.length - 1] += text.slice(start, end);
    return true;
  });
  return blocks.filter(Boolean).join(" · ");
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
  const { onShow, onMove, onHide, getPopoverElement } = options;
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

    const primary = changeAtCaret(pending, head);

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
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      if (visible) {
        visible = false;
        lastKey = null;
        onHide();
      }
      return;
    }

    const primaryIsConflict = !!primary.dataTracked.isConflict;

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
    // A replacement's deletion and insertion share a groupId; aggregate them so
    // the popover shows the whole replacement. Deciding either half decides both.
    const primaryGroupId = primary.dataTracked.groupId;
    let groupIds: string[] = [primary.id];
    let replacedText: string | undefined;
    let insertedText: string | undefined;

    if (primaryGroupId) {
      const groupChanges = pending.filter(
        (c) => c.dataTracked.groupId === primaryGroupId,
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

    const NODE_TYPE_LABELS: Record<string, string> = {
      bulletList: "Bullet list",
      orderedList: "Ordered list",
      paragraph: "Paragraph",
      heading: "Heading",
      blockquote: "Blockquote",
      codeBlock: "Code block",
    };

    const toInfo = (c: typeof primary): ChangePopoverInfo => {
      const op = c.dataTracked.operation;

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
      let oldNodeTypeName: string | undefined;
      let newNodeTypeName: string | undefined;
      if (op === CHANGE_OPERATION.set_node_attributes && c.type === "node-attr-change") {
        oldAttrs = c.oldAttrs;
        newAttrs = c.newAttrs;
        oldNodeTypeName = c.oldNodeTypeName;
        newNodeTypeName = c.newNodeTypeName;
      }

      // ── Move operation fields ────────────────────────────────────────────────
      const moveNodeId = c.dataTracked.moveNodeId;
      let moveRole: "source" | "destination" | undefined;
      if (moveNodeId) {
        moveRole = op === CHANGE_OPERATION.delete ? "source" : "destination";
      }

      // ── Mark change fields ───────────────────────────────────────────────────
      let markName: string | undefined;
      if (c.type === "mark-change") {
        markName = c.mark.type.name;
      }

      // ── Text preview — kind-aware ────────────────────────────────────────────
      // For node-attr changes, show the attr diff instead of raw node text.
      // For mark changes, show the affected text.
      // For all others, read the document text between from/to.
      let text: string;
      if (changeKind === "node-attr" && oldNodeTypeName && newNodeTypeName) {
        // Node type changed (e.g. bulletList → orderedList): show type labels
        // directly — diffing attrs would produce "order: 1 → default".
        const fromLabel = NODE_TYPE_LABELS[oldNodeTypeName] ?? oldNodeTypeName;
        const toLabel   = NODE_TYPE_LABELS[newNodeTypeName] ?? newNodeTypeName;
        text = `${fromLabel} → ${toLabel}`;
      } else if (changeKind === "node-attr" && oldAttrs && newAttrs) {
        // Empty string when no meaningful attrs differ — the popover will show
        // the "Style changed" badge without a misleading preview row.
        text = describeAttrChanges(oldAttrs, newAttrs);
      } else if (c.type === "node-change") {
        text = changePreviewText(state.doc, c, pending);
      } else {
        text = readText(c.from, c.to);
      }

      return {
        id: c.id,
        operation: op,
        authorID: c.dataTracked.authorID ?? "unknown",
        status: c.dataTracked.status,
        from: c.from,
        to: c.to,
        text,
        isConflict: !!c.dataTracked.isConflict,
        conflictChanges: [],
        groupIds,
        changeKind,
        ...(replacedText !== undefined ? { replacedText } : {}),
        ...(insertedText !== undefined ? { insertedText } : {}),
        ...(oldAttrs !== undefined ? { oldAttrs } : {}),
        ...(newAttrs !== undefined ? { newAttrs } : {}),
        ...(oldNodeTypeName !== undefined ? { oldNodeTypeName } : {}),
        ...(newNodeTypeName !== undefined ? { newNodeTypeName } : {}),
        ...(moveNodeId !== undefined ? { moveNodeId } : {}),
        ...(c.dataTracked.moveId !== undefined ? { moveId: c.dataTracked.moveId } : {}),
        ...(moveRole !== undefined ? { moveRole } : {}),
        ...(markName !== undefined ? { markName } : {}),
        ...(c.type === "node-change" || c.type === "node-attr-change" ? { nodeTypeName: c.node.type.name } : {}),
      };
    };

    const primaryInfo = toInfo(primary);
    primaryInfo.isConflict = isConflict;
    // One party per act: a whole-paragraph change is recorded on the node and on
    // its text, and those are one thing to keep or to discard.
    const parties = changeActs(conflictGroup).map((act) => act.primary);
    primaryInfo.conflictChanges = isConflict ? parties.map(toInfo) : [];

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

  // subscribe() covers doc/selection changes; subscribeViewUpdates also
  // catches scroll / resize so the popover follows its anchor.
  const offState = editor.subscribe(update);
  const offView = subscribeViewUpdates(editor, update);
  // Editor blur (click outside the editor entirely) doesn't change state,
  // so the two subscriptions above miss it. Forces hide unless focus moved
  // into the popover's own DOM.
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      if (visible) { visible = false; lastKey = null; onHide(); }
    },
    getPopoverElement ? { getPopoverElement } : {},
  );
  const unsubscribe = () => { offState(); offView(); offFocusOutside(); };

  return () => {
    unsubscribe();
    if (visible) {
      visible = false;
      lastKey = null;
      onHide();
    }
  };
}
