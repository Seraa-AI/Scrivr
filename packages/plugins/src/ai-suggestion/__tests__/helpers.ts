/**
 * Shared test helpers for ai-suggestion integration tests.
 *
 * Provides a minimal ProseMirror schema (paragraph + heading + text +
 * trackedInsert/trackedDelete marks, all with nodeId attrs) and a
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
import type { IEditor, SelectionController, DocumentLayout } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import type { AiSuggestion } from "../types";
import type {
  ApplyAiSuggestionOptions,
  RejectAiSuggestionOptions,
} from "../types";

/** Schema */

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

/** Builder helpers */

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

export function doc(...nodes: PmNode[]) {
  return schema.nodes.doc.create(null, nodes);
}

/** IEditor stub */

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
    initialDoc: PmNode,
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

  on(_event: string, _handler: unknown): () => void {
    return () => {};
  }

  /** IEditor stubs (canvas/DOM — not needed in tests) */
  addOverlayRenderHandler(_handler: unknown): () => void {
    return () => {};
  }
  get layout(): DocumentLayout {
    return null as never;
  }
  getViewportRect(_from: number, _to: number): DOMRect | null {
    return null;
  }
  getNodeViewportRect(_docPos: number): DOMRect | null {
    return null;
  }
  getScrollContainerRect(): DOMRect | null {
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
  /** SelectionController stub — only moveCursorTo is called by AI suggestion code. */
  readonly selection = {
    moveCursorTo: (_pos: number): void => {},
    setSelection: (_a: number, _h: number): void => {},
    moveLeft: (_e?: boolean): void => {},
    moveRight: (_e?: boolean): void => {},
    moveUp: (_e?: boolean): void => {},
    moveDown: (_e?: boolean): void => {},
    moveWordLeft: (_e?: boolean): void => {},
    moveWordRight: (_e?: boolean): void => {},
    moveToLineStart: (_e?: boolean): void => {},
    moveToLineEnd: (_e?: boolean): void => {},
    moveToDocStart: (_e?: boolean): void => {},
    moveToDocEnd: (_e?: boolean): void => {},
    deleteWordBackward: (): void => {},
    deleteWordForward: (): void => {},
    selectWordAt: (_p: number) => ({ from: 0, to: 0 }),
    selectBlockAt: (_p: number): void => {},
    wordBoundary: (_p: number, _d: -1 | 1) => 0,
  } as SelectionController;
  get readOnly(): boolean { return false; }
  setReadOnly(_value: boolean): void {}

  /** Convenience helpers */

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
