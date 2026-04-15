/**
 * Shared test helpers for track-changes integration tests.
 *
 * Provides a minimal ProseMirror schema (paragraph + heading + text +
 * trackedInsert/trackedDelete marks) and a lightweight editor harness that
 * wires up the trackChangesPlugin + prosemirror-history so undo/redo works.
 *
 * NOTE: EditorState.apply() internally runs the appendTransaction loop, so
 * the harness just calls state.apply(tr) — no manual loop needed.
 */

import { Schema } from "prosemirror-model";
import type { Node as PmNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { trackChangesPlugin, trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { CHANGE_STATUS, TrackChangesStatus } from "../types";
import { setAction, TrackChangesAction } from "../actions";

// ── Schema ────────────────────────────────────────────────────────────────────

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: {
        dataTracked: { default: null },
        nodeId:      { default: null },
        align:       { default: null },
      },
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        level:       { default: 1 },
        dataTracked: { default: null },
        nodeId:      { default: null },
        align:       { default: null },
      },
    },
    bullet_list: {
      group: "block",
      content: "list_item+",
      attrs: {
        dataTracked: { default: null },
        nodeId:      { default: null },
      },
    },
    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: {
        dataTracked: { default: null },
        nodeId:      { default: null },
      },
    },
    list_item: {
      content: "paragraph+",
      attrs: {
        dataTracked: { default: null },
        nodeId:      { default: null },
      },
    },
    text: { group: "inline" },
  },
  marks: {
    trackedInsert: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
    trackedDelete: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
  },
});

// ── Builder helpers ───────────────────────────────────────────────────────────

export function p(text: string, attrs?: Record<string, unknown>) {
  return schema.nodes.paragraph.create(attrs ?? null, text ? schema.text(text) : undefined);
}

export function h(level: number, text: string, attrs?: Record<string, unknown>) {
  return schema.nodes.heading.create({ level, ...attrs }, text ? schema.text(text) : undefined);
}

export function doc(...nodes: PmNode[]) {
  return schema.nodes.doc.create(null, nodes);
}

export function li(text: string) {
  return schema.nodes.list_item.create(null, p(text));
}

export function ul(...items: ReturnType<typeof li>[]) {
  return schema.nodes.bullet_list.create(null, items);
}

export function ol(...items: ReturnType<typeof li>[]) {
  return schema.nodes.ordered_list.create(null, items);
}

// ── Editor harness ────────────────────────────────────────────────────────────

/**
 * Lightweight stateful editor that wires up track-changes + history plugins.
 *
 * EditorState.apply() runs the appendTransaction loop internally, so a plain
 * state.apply(tr) call is all that's needed to get tracking + history working.
 */
export class TestEditor {
  state: EditorState;

  constructor(initialDoc: PmNode, authorID = "user1") {
    this.state = EditorState.create({
      doc: initialDoc,
      plugins: [
        history(),
        trackChangesPlugin({
          userID: authorID,
          initialStatus: TrackChangesStatus.enabled,
        }),
      ],
    });
  }

  dispatch(tr: Transaction) {
    this.state = this.state.apply(tr);
    return this;
  }

  insertAt(pos: number, text: string) {
    return this.dispatch(this.state.tr.insertText(text, pos));
  }

  deleteRange(from: number, to: number) {
    return this.dispatch(this.state.tr.delete(from, to));
  }

  undo() {
    undo(this.state, tr => { this.state = this.state.apply(tr); });
    return this;
  }

  redo() {
    redo(this.state, tr => { this.state = this.state.apply(tr); });
    return this;
  }

  get text(): string {
    return this.state.doc.textContent;
  }

  get pendingChanges() {
    return trackChangesPluginKey.getState(this.state)?.changeSet.changes.filter(
      c => c.dataTracked.status === "pending",
    ) ?? [];
  }

  get allChanges() {
    return trackChangesPluginKey.getState(this.state)?.changeSet.changes ?? [];
  }

  acceptChanges(ids: string[]) {
    return this.dispatch(
      setAction(this.state.tr, TrackChangesAction.setChangeStatuses, {
        status: CHANGE_STATUS.accepted,
        ids,
      }),
    );
  }

  rejectChanges(ids: string[]) {
    return this.dispatch(
      setAction(this.state.tr, TrackChangesAction.setChangeStatuses, {
        status: CHANGE_STATUS.rejected,
        ids,
      }),
    );
  }

  setUserID(id: string) {
    return this.dispatch(
      setAction(this.state.tr, TrackChangesAction.setUserID, id),
    );
  }
}
