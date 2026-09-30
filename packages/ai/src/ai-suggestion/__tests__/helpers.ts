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
import type { Node as PmNode } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
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
  /**
   * `trackChanges: false` drops the extension entirely — the shape a host that
   * uses the suggestion lane without review gets, where a tracked apply has no
   * tracked mark to write with.
   */
  constructor(initialDoc: PmNode, authorID = "user1", options: { trackChanges?: boolean } = {}) {
    super({
      extensions: [
        StarterKit,
        ...(options.trackChanges === false
          ? []
          : [TrackChanges.configure({ userID: authorID, initialStatus: TrackChangesStatus.enabled })]),
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

/** Text carrying a given mark — how a reader would see a formatting change. */
export function markedText(editor: ServerEditor, markName: string): string {
  let out = "";
  editor.getState().doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === markName)) out += node.text;
  });
  return out;
}
