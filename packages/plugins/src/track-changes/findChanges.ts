import { Node as PMNode } from "@scrivr/core/pm";
import { EditorState } from "@scrivr/core/pm";

import { ChangeSet } from "./ChangeSet";
import { joinedBlockAt } from "./lib/deleteBreak";
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
  TrackedAttrs,
} from "./types";

type PartialNodeTrackedChange =
  | PartialChange<TextChange>
  | PartialChange<NodeAttrChange>
  | PartialChange<ReferenceChange>
  | PartialChange<NodeChange>;

type ChangeBuilder = (
  node: PMNode,
  pos: number,
  id: string,
  dataTracked: Partial<TrackedAttrs>,
  doc: PMNode,
) => PartialNodeTrackedChange;

const changeBase = (node: PMNode, pos: number, id: string, dataTracked: Partial<TrackedAttrs>) => ({
  id,
  from: pos,
  to: pos + node.nodeSize,
  dataTracked: { ...dataTracked },
});

const textChange: ChangeBuilder = (node, pos, id, dataTracked) => ({
  ...changeBase(node, pos, id, dataTracked),
  type: "text-change",
  text: node.text ?? "",
  nodeType: node.type,
});

const nodeAttrChange: ChangeBuilder = (node, pos, id, dataTracked) => {
  const update = dataTracked.operation === CHANGE_OPERATION.set_node_attributes ? dataTracked : undefined;
  const oldNodeTypeName = update?.oldNodeTypeName;
  return {
    ...changeBase(node, pos, id, dataTracked),
    type: "node-attr-change",
    node,
    newAttrs: { ...node.attrs },
    oldAttrs: { ...update?.oldAttrs },
    ...(oldNodeTypeName ? { oldNodeTypeName, newNodeTypeName: node.type.name } : {}),
  };
};

const referenceChange: ChangeBuilder = (node, pos, id, dataTracked) => ({
  ...changeBase(node, pos, id, dataTracked),
  type: "reference-change",
});

const nodeChange: ChangeBuilder = (node, pos, id, dataTracked, doc) => {
  const joinsAt = dataTracked.operation === CHANGE_OPERATION.node_join ? joinedBlockAt(doc, pos + node.nodeSize) : undefined;
  return {
    ...changeBase(node, pos, id, dataTracked),
    type: "node-change",
    node,
    children: [],
    attrs: { ...node.attrs },
    ...(joinsAt !== undefined ? { joinsAt } : {}),
  };
};

/**
 * Block changes whose shape depends on the operation; any other operation is a
 * node-change. A map, not an object: a synced record may name any operation,
 * "toString" included, which an object lookup finds on its prototype.
 */
const BUILD = new Map<string, ChangeBuilder>([
  [CHANGE_OPERATION.set_node_attributes, nodeAttrChange],
  [CHANGE_OPERATION.reference, referenceChange],
]);

/**
 * Finds all tracked changes (text marks or node attributes) in the document.
 */
export function findChanges(state: EditorState): ChangeSet {
  const changes: IncompleteChange[] = [];
  // Map from change ID → active group. Supports multiple marks per text node
  // (e.g. trackedInsert + trackedDelete stacked from different authors).
  const currentMap = new Map<string, { change: PartialNodeTrackedChange; node: PMNode }>();
  // Parallel map for inline mark-based changes (trackedInsert / trackedDelete marks).
  const markMap = new Map<string, { change: PartialChange<MarkChange>; node: PMNode }>();

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
            existing.change.text += node.text ?? "";
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
              },
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
      // Skip entries with no valid ID — avoids merging unrelated changes
      // under the "" key.
      const id = dataTracked?.id;
      if (!dataTracked || !id) continue;

      if (currentMap.has(id)) {
        // Extend the existing group to cover this node.
        const existing = currentMap.get(id)!;
        existing.change.to = pos + node.nodeSize;
        existing.node = node;
        // Accumulate text so multi-node text groups contain full content.
        if (node.isText && existing.change.type === "text-change") {
          existing.change.text += node.text ?? "";
        }
        continue;
      }

      const op = dataTracked.operation;
      const build = node.isText ? textChange : (op && BUILD.get(op)) ?? nodeChange;
      const change = build(node, pos, id, dataTracked, state.doc);

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
