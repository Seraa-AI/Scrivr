import { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";

import { ChangeSet } from "./ChangeSet";
import { getMarkTrackedData, getNodeTrackedData } from "./helpers";
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  IncompleteChange,
  MarkChange,
  NodeAttrChange,
  NodeChange,
  PartialChange,
  ReferenceChange,
  TextChange,
} from "./types";

/**
 * Finds all tracked changes (text marks or node attributes) in the document.
 */
export function findChanges(state: EditorState): ChangeSet {
  const changes: IncompleteChange[] = [];
  // Map from change ID → active group. Supports multiple marks per text node
  // (e.g. tracked_insert + tracked_delete stacked from different authors).
  const currentMap = new Map<string, { change: IncompleteChange; node: PMNode }>();

  state.doc.descendants((node, pos) => {
    const tracked = getNodeTrackedData(node, state.schema) || [];

    const marksWithTrackChanges = getMarkTrackedData(node);
    marksWithTrackChanges?.forEach((trackAttrs, mark) => {
      trackAttrs.forEach(c => {
        const ch = {
          id: c.id,
          type: "mark-change",
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...c },
          nodeType: node.type,
          node: node,
          mark: mark,
        } as MarkChange;
        changes.push(ch);
      });
    });

    // Build the set of IDs active in this node so we can flush stale groups.
    const activeIds = new Set(tracked.map(d => d?.id || "").filter(Boolean));

    // Flush groups whose IDs didn't appear in this node (the mark sequence ended).
    if (tracked.length > 0) {
      for (const [id, c] of Array.from(currentMap.entries())) {
        if (!activeIds.has(id)) {
          changes.push(c.change);
          currentMap.delete(id);
        }
      }
    }

    for (let i = 0; i < tracked.length; i += 1) {
      const dataTracked = tracked[i];
      const id = dataTracked?.id || "";

      if (currentMap.has(id)) {
        // Extend the existing group to cover this node.
        currentMap.get(id)!.change.to = pos + node.nodeSize;
        currentMap.get(id)!.node = node;
        continue;
      }

      let change: IncompleteChange;
      if (node.isText) {
        change = {
          id,
          type: "text-change",
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
          text: node.text,
          nodeType: node.type,
        } as PartialChange<TextChange>;
      } else if (dataTracked?.operation === CHANGE_OPERATION.set_node_attributes) {
        change = {
          id,
          type: "node-attr-change",
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
          node: node,
          newAttrs: { ...node.attrs },
          oldAttrs: { ...dataTracked?.oldAttrs },
        } as NodeAttrChange;
      } else if (dataTracked?.operation === CHANGE_OPERATION.reference) {
        change = {
          id,
          type: "reference-change",
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
        } as ReferenceChange;
      } else {
        change = {
          id,
          type: "node-change",
          from: pos,
          to: pos + node.nodeSize,
          dataTracked: { ...dataTracked },
          node: node,
          children: [],
          attrs: { ...node.attrs },
        } as PartialChange<NodeChange>;
      }

      currentMap.set(id, { change, node });
    }

    // Node with no tracked data ends all active groups (block boundary).
    if (tracked.length === 0 && currentMap.size > 0) {
      currentMap.forEach(c => changes.push(c.change));
      currentMap.clear();
    }
  });

  // Flush any remaining open groups.
  currentMap.forEach(c => changes.push(c.change));

  // ── Conflict detection (computed, no mark mutations) ───────────────────────
  // Two pending changes conflict when they overlap in document range AND belong
  // to different authors. This is the authoritative source of isConflict — we
  // set it on the dataTracked copy inside the ChangeSet so the renderer and
  // popover pick it up without any mark fragmentation.
  const pending = changes.filter(c => c.dataTracked.status === CHANGE_STATUS.pending);
  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const a = pending[i]!;
      const b = pending[j]!;
      if (a.dataTracked.authorID === b.dataTracked.authorID) continue;
      // Only flag as conflict when operations are opposing (insert vs delete).
      // Two inserts from different authors coexisting in the same range is normal
      // multi-author collaboration, not a conflict.
      const aOp = a.dataTracked.operation;
      const bOp = b.dataTracked.operation;
      const areOpposing =
        (aOp === CHANGE_OPERATION.insert && bOp === CHANGE_OPERATION.delete) ||
        (aOp === CHANGE_OPERATION.delete && bOp === CHANGE_OPERATION.insert);
      if (!areOpposing) continue;
      if (a.from < b.to && a.to > b.from) {
        (a.dataTracked as Record<string, unknown>).isConflict = true;
        (b.dataTracked as Record<string, unknown>).isConflict = true;
      }
    }
  }

  return new ChangeSet(changes);
}
