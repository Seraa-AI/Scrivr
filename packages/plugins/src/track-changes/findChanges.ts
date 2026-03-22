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
  let current: { change: IncompleteChange; node: PMNode } | undefined;

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

    for (let i = 0; i < tracked.length; i += 1) {
      const dataTracked = tracked[i];
      const id = dataTracked?.id || "";

      if (current && current.change.id === id) {
        current.change.to = pos + node.nodeSize;
        current.node = node;
        continue;
      }

      current && changes.push(current.change);

      let change;
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

      current = { change, node };
    }

    if (tracked.length === 0 && current) {
      changes.push(current.change);
      current = undefined;
    }
  });

  current && changes.push(current.change);

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
      if (a.from < b.to && a.to > b.from) {
        (a.dataTracked as Record<string, unknown>).isConflict = true;
        (b.dataTracked as Record<string, unknown>).isConflict = true;
      }
    }
  }

  return new ChangeSet(changes);
}
