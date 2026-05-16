/**
 * Shared test helpers for ai-suggestion integration tests.
 *
 * Provides a minimal ProseMirror schema (paragraph + heading + text +
 * trackedInsert/trackedDelete marks, all with nodeId attrs) and an
 * `AiTestEditor` that extends the real headless `ServerEditor` with a
 * pinch of test sugar (`showSuggestion`, `apply`, `reject`, `text`,
 * `suggestionState`). No hand-rolled `IEditor` stub — the test driver is
 * a real editor.
 */

import { Schema } from "prosemirror-model";
import type { NodeSpec, MarkSpec } from "prosemirror-model";
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
import { ServerEditor, Extension } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import type { AiSuggestion } from "../types";
import type {
  ApplyAiSuggestionOptions,
  RejectAiSuggestionOptions,
} from "../types";

// ── Schema specs (single source of truth) ────────────────────────────────────
//
// The `schema` constant below and the `TestSchemaExtension`'s addNodes /
// addMarks both consume these specs, so the local builders (p, h, doc) and
// the editor's runtime schema stay byte-equivalent — JSON round-trips
// through ServerEditor without surprises.

const nodeSpecs: Record<string, NodeSpec> = {
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
};

const markSpecs: Record<string, MarkSpec> = {
  trackedInsert: {
    excludes: "",
    attrs: { dataTracked: { default: {} } },
  },
  trackedDelete: {
    excludes: "",
    attrs: { dataTracked: { default: {} } },
  },
};

/** Local schema — used by the `p`/`h`/`doc` node builders below. */
export const schema = new Schema({ nodes: nodeSpecs, marks: markSpecs });

// ── Node builders ────────────────────────────────────────────────────────────

export function p(text: string, nodeId?: string) {
  return schema.node(
    "paragraph",
    { nodeId: nodeId ?? null },
    text ? schema.text(text) : undefined,
  );
}

export function h(level: number, text: string, nodeId?: string) {
  return schema.node(
    "heading",
    { level, nodeId: nodeId ?? null },
    text ? schema.text(text) : undefined,
  );
}

export function doc(...nodes: PmNode[]) {
  return schema.node("doc", null, nodes);
}

// ── Test fixture extension ───────────────────────────────────────────────────
//
// Contributes the minimal schema + the plugins under test. Configured per
// AiTestEditor instance with the author id used by trackChangesPlugin.

interface TestSchemaOptions {
  authorID: string;
}

const TestSchemaExtension = Extension.create<TestSchemaOptions>({
  name: "ai_test_schema",
  defaultOptions: { authorID: "user1" },
  addNodes: () => nodeSpecs,
  addMarks: () => markSpecs,
  addProseMirrorPlugins() {
    return [
      history(),
      trackChangesPlugin({
        userID: this.options.authorID,
        initialStatus: TrackChangesStatus.enabled,
      }),
      aiSuggestionPlugin,
    ];
  },
});

// ── AiTestEditor ─────────────────────────────────────────────────────────────

/**
 * Real headless editor (extends `ServerEditor`) with a pinch of test sugar
 * for ai-suggestion suites: pass a built-in-builders doc, get back an
 * editor whose `showSuggestion` / `apply` / `reject` methods route to the
 * real `showAiSuggestion` / `applyAiSuggestion` / `rejectAiSuggestion`
 * functions against this editor instance.
 */
export class AiTestEditor extends ServerEditor {
  constructor(initialDoc: PmNode, authorID = "user1") {
    super({
      extensions: [TestSchemaExtension.configure({ authorID })],
      content: initialDoc.toJSON() as Record<string, unknown>,
    });
  }

  /** Plain-text contents of the doc — for one-shot assertion shortcuts. */
  get text(): string {
    return this.getState().doc.textContent;
  }

  /** Current ai-suggestion plugin state (or null if none active). */
  get suggestionState() {
    return aiSuggestionPluginKey.getState(this.getState());
  }

  showSuggestion(suggestion: AiSuggestion | null): void {
    showAiSuggestion(this, suggestion);
  }

  apply(options: ApplyAiSuggestionOptions): void {
    applyAiSuggestion(this, options);
  }

  reject(options?: RejectAiSuggestionOptions): void {
    rejectAiSuggestion(this, options);
  }
}
