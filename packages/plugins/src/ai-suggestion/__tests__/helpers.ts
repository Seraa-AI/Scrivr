/**
 * Shared test helpers for ai-suggestion integration tests.
 *
 * Provides a minimal ProseMirror schema (paragraph + heading + text +
 * tracked_insert/tracked_delete marks, all with nodeId attrs) and a
 * lightweight editor harness that wires up aiSuggestionPlugin +
 * trackChangesPlugin so apply/reject commands work end-to-end.
 */

import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { history } from "prosemirror-history";
import { trackChangesPlugin } from "../../track-changes/engine/trackChangesPlugin";
import { TrackChangesStatus } from "../../track-changes/types";
import {
  aiSuggestionPlugin,
  aiSuggestionPluginKey,
} from "../AiSuggestionPlugin";
import {
  showAiSuggestion,
  applyAiSuggestion,
  rejectAiSuggestion,
} from "../showHideApply";
import type { IEditor } from "@scrivr/core";
import type { AiSuggestion } from "../types";
import type {
  ApplyAiSuggestionOptions,
  RejectAiSuggestionOptions,
} from "../types";

// ── Schema ────────────────────────────────────────────────────────────────────

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: {
        dataTracked: { default: null },
        nodeId: { default: null },
        align: { default: null },
      },
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: {
        level: { default: 1 },
        dataTracked: { default: null },
        nodeId: { default: null },
        align: { default: null },
      },
    },
    text: { group: "inline" },
  },
  marks: {
    tracked_insert: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
    tracked_delete: {
      excludes: "",
      attrs: { dataTracked: { default: {} } },
    },
  },
});

// ── Builder helpers ───────────────────────────────────────────────────────────

export function p(text: string, nodeId?: string) {
  return schema.nodes.paragraph.create(
    { nodeId: nodeId ?? null },
    text ? schema.text(text) : undefined,
  );
}

export function h(level: number, text: string, nodeId?: string) {
  return schema.nodes.heading.create(
    { level, nodeId: nodeId ?? null },
    text ? schema.text(text) : undefined,
  );
}

export function doc(...nodes: import("prosemirror-model").Node[]) {
  return schema.nodes.doc.create(null, nodes);
}

// ── IEditor stub ──────────────────────────────────────────────────────────────

/**
 * Minimal IEditor stub — enough for showAiSuggestion / applyAiSuggestion /
 * rejectAiSuggestion / subscribeToAiSuggestions to work without a real Editor.
 *
 * Implements the full IEditor interface with no-op stubs for canvas/DOM methods.
 */
export class TestAiEditor implements IEditor {
  state: EditorState;
  private _subscribers: Array<() => void> = [];

  constructor(
    initialDoc: import("prosemirror-model").Node,
    authorID = "user1",
  ) {
    this.state = EditorState.create({
      doc: initialDoc,
      plugins: [
        history(),
        trackChangesPlugin({
          userID: authorID,
          initialStatus: TrackChangesStatus.enabled,
        }),
        aiSuggestionPlugin,
      ],
    });
  }

  getState(): EditorState {
    return this.state;
  }

  _applyTransaction(tr: Transaction): void {
    this.state = this.state.apply(tr);
    for (const cb of this._subscribers) cb();
  }

  subscribe(cb: () => void): () => void {
    this._subscribers.push(cb);
    return () => {
      this._subscribers = this._subscribers.filter((s) => s !== cb);
    };
  }

  // ── IEditor stubs (canvas/DOM — not needed in tests) ─────────────────────
  addOverlayRenderHandler(_handler: unknown): () => void {
    return () => {};
  }
  get layout(): import("@scrivr/core").DocumentLayout {
    return null as never;
  }
  getViewportRect(_from: number, _to: number): DOMRect | null {
    return null;
  }
  getNodeViewportRect(_docPos: number): DOMRect | null {
    return null;
  }
  selectNode(_docPos: number): void {}
  setNodeAttrs(_docPos: number, _attrs: Record<string, unknown>): void {}
  redraw(): void {}
  setReady(_ready: boolean): void {}
  get loadingState(): "syncing" | "rendering" | "ready" {
    return "ready";
  }
  getMarkdown(): string {
    return "";
  }
  moveCursorTo(_pos: number): void {
    /* no-op in tests */
  }

  // ── Convenience helpers ───────────────────────────────────────────────────

  get text(): string {
    return this.state.doc.textContent;
  }

  get suggestionState() {
    return aiSuggestionPluginKey.getState(this.state);
  }

  showSuggestion(suggestion: AiSuggestion | null) {
    showAiSuggestion(this, suggestion);
  }

  apply(options: ApplyAiSuggestionOptions) {
    applyAiSuggestion(this, options);
  }

  reject(options?: RejectAiSuggestionOptions) {
    rejectAiSuggestion(this, options);
  }
}
