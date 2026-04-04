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
  // Parallel map for inline mark-based changes (tracked_insert / tracked_delete marks).
  const markMap = new Map<string, { change: IncompleteChange; node: PMNode }>();

  state.doc.descendants((node, pos) => {
    // ── Mark grouping ─────────────────────────────────────────────────────────
    // Marks can't cross block boundaries in ProseMirror, so flush all in-flight
    // mark groups when we encounter a block node.
    if (node.isBlock && markMap.size > 0) {
      markMap.forEach(c => changes.push(c.change));
      markMap.clear();
    }

    const marksWithTrackChanges = getMarkTrackedData(node);
    if (marksWithTrackChanges.size > 0) {
      // Build the set of tracking IDs active in this node.
      const activeMarkIds = new Set<string>();
      marksWithTrackChanges.forEach(trackAttrs =>
        trackAttrs.forEach(c => { if (c.id) activeMarkIds.add(c.id); }),
      );

      // Flush stale mark groups (IDs that ended before this node).
      for (const [id, c] of Array.from(markMap.entries())) {
        if (!activeMarkIds.has(id)) {
          changes.push(c.change);
          markMap.delete(id);
        }
      }

      // Extend existing groups or open new ones.
      marksWithTrackChanges.forEach((trackAttrs, mark) => {
        trackAttrs.forEach(c => {
          const id = c.id;
          if (!id) return;
          if (markMap.has(id)) {
            const existing = markMap.get(id)!;
            existing.change.to = pos + node.nodeSize;
            existing.node = node;
            (existing.change as PartialChange<MarkChange>).text += node.text ?? "";
          } else {
            markMap.set(id, {
              change: {
                id,
                type: "mark-change",
                from: pos,
                to: pos + node.nodeSize,
                dataTracked: { ...c },
                nodeType: node.type,
                node,
                mark,
                text: node.text ?? "",
              } as PartialChange<MarkChange>,
              node,
            });
          }
        });
      });
    }

    // ── Node attribute tracking ───────────────────────────────────────────────
    const tracked = getNodeTrackedData(node, state.schema) || [];

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
      // Fix 1: skip entries with no valid ID — avoids merging unrelated changes
      // under the "" key.
      const id = dataTracked?.id;
      if (!id) continue;

      if (currentMap.has(id)) {
        // Extend the existing group to cover this node.
        const existing = currentMap.get(id)!;
        existing.change.to = pos + node.nodeSize;
        existing.node = node;
        // Fix 2: accumulate text so multi-node text groups contain full content.
        if (node.isText && existing.change.type === "text-change") {
          (existing.change as PartialChange<TextChange>).text += node.text ?? "";
        }
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
  markMap.forEach(c => changes.push(c.change));

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
        a.dataTracked = { ...a.dataTracked, isConflict: true };
        b.dataTracked = { ...b.dataTracked, isConflict: true };
      }
    }
  }

  return new ChangeSet(changes);
}
