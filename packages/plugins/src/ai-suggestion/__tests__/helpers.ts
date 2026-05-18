/**
 * Shared test helpers for ai-suggestion integration tests.
 *
 * Drives a real headless `ServerEditor` wired with the production
 * `StarterKit` + `TrackChanges` extensions (so the schema, paragraph
 * attrs, and tracked marks match production) plus a tiny in-test
 * extension that contributes the `aiSuggestionPlugin`. No custom test
 * schema, no hand-rolled `IEditor` stub — the test driver is the
 * production schema with production plugins.
 */

import {
  ServerEditor,
  Extension,
  StarterKit,
  getSchema,
} from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import { TrackChanges } from "../../track-changes/TrackChanges";
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
import type { AiSuggestion } from "../types";
import type {
  ApplyAiSuggestionOptions,
  RejectAiSuggestionOptions,
} from "../types";

// ── Real schema (shared across builders + editor instances) ──────────────────
//
// Built once at module load from the production `StarterKit` + `TrackChanges`
// extensions. The `p`/`h`/`doc` builders below use this schema to construct
// PM Nodes, and `AiTestEditor` constructs a `ServerEditor` with the same
// extensions — so what the builders produce and what the editor accepts are
// the same Schema instance (well, structurally identical: ServerEditor
// rebuilds its own copy via the same extension list).

export const schema = getSchema([StarterKit, TrackChanges]);

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

// ── In-test extension: contributes only the ai suggestion plugin ─────────────

const AiSuggestionTestExtension = Extension.create({
  name: "ai_suggestion_test_plugin",
  addProseMirrorPlugins: () => [aiSuggestionPlugin],
});

// ── AiTestEditor ─────────────────────────────────────────────────────────────

/**
 * Real headless editor (extends `ServerEditor`) with a pinch of test sugar
 * for ai-suggestion suites. Same extensions a production editor would use
 * for track-changes work: `StarterKit` + `TrackChanges` (configured per
 * author) + the ai-suggestion plugin. Sugar methods route to the real
 * `showAiSuggestion` / `applyAiSuggestion` / `rejectAiSuggestion`.
 */
export class AiTestEditor extends ServerEditor {
  constructor(initialDoc: PmNode, authorID = "user1") {
    super({
      extensions: [
        StarterKit,
        TrackChanges.configure({
          userID: authorID,
          initialStatus: TrackChangesStatus.enabled,
        }),
        AiSuggestionTestExtension,
      ],
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
