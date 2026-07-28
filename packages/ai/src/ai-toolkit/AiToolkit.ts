import { Extension } from "@scrivr/core";
import type { IBaseEditor, IEditor, InlineSpan, SemanticPart, SemanticUnit } from "@scrivr/core";
import { semanticPartRichHash, toSemanticUnits, unitRichHash } from "@scrivr/export-semantic";
import type { InlineSpan as EditInlineSpan, SemanticEdit } from "../schema/edit";
import { UniqueId } from "./UniqueId";
import { GhostText, ghostTextPluginKey } from "./GhostText";
import { AiCaret, aiCaretPluginKey } from "./AiCaret";
import { findNodeById } from "./UniqueId";
import { aiToolkitRegistry } from "./aiToolkitRegistry";
import { applyRichDiffAsSuggestion, buildAcceptedTextMap, type RichBlockEdit } from "@scrivr/plugins";

export { unitRichHash };
import type { Schema } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { AiSuggestion as AiSuggestionExtension } from "../ai-suggestion/AiSuggestion";
import { computeAiSuggestion } from "../ai-suggestion/computeAiSuggestion";
import { showAiSuggestion, applyAiSuggestion, rejectAiSuggestion } from "../ai-suggestion/showHideApply";
import { aiSuggestionPluginKey } from "../ai-suggestion/AiSuggestionPlugin";
import type { AiSuggestion as AiSuggestionData, ApplyAiSuggestionOptions, RejectAiSuggestionOptions } from "../ai-suggestion/types";
import type { ComputeAiSuggestionOptions } from "../ai-suggestion/computeAiSuggestion";

/**
 * Namespaced API for AI suggestion overlay — accessed via `ai.suggestions`.
 *
 * All methods are thin wrappers around the standalone functions in
 * showHideApply.ts, bound to the editor instance so callers don't need to
 * manage state/dispatch themselves.
 */
export class AiSuggestionsAPI {
  constructor(private readonly editor: IBaseEditor) {}

  /**
   * Compute a word-level diff between the current document and proposed text.
   * Pure — no document mutation.
   *
   * @returns Serializable AiSuggestion JSON, or null if no changes detected.
   *
   * @example
   * const s = ai.suggestions.compute({
   *   blocks: [{ nodeId, proposedText: "..." }],
   *   authorID: "AI Assistant",
   * });
   * if (s) await db.save(s);
   */
  compute(options: ComputeAiSuggestionOptions): AiSuggestionData | null {
    return computeAiSuggestion(this.editor.getState(), options);
  }

  /**
   * Display a suggestion as a canvas overlay. The document is NOT modified.
   * Pass a previously saved AiSuggestion JSON to restore across sessions.
   */
  show(suggestion: AiSuggestionData): void {
    showAiSuggestion(this.editor, suggestion);
  }

  /** Hide the current suggestion overlay without modifying the document. */
  hide(): void {
    showAiSuggestion(this.editor, null);
  }

  /**
   * Apply the current suggestion (or a specific group/block) to the document.
   *
   * @param options.mode     "direct" — plain replace. "tracked" — adds track-changes marks.
   * @param options.groupId  Apply only this group; others remain in the overlay.
   * @param options.blockId  Apply only this block; others remain in the overlay.
   */
  apply(options: ApplyAiSuggestionOptions): void {
    applyAiSuggestion(this.editor, options);
  }

  /**
   * Reject (discard) the current suggestion or a specific group/block.
   * No document changes — the overlay is simply hidden or trimmed.
   */
  reject(options?: RejectAiSuggestionOptions): void {
    rejectAiSuggestion(this.editor, options);
  }

  /** Returns the currently displayed suggestion, or null. */
  getCurrent(): AiSuggestionData | null {
    return aiSuggestionPluginKey.getState(this.editor.getState())?.suggestion ?? null;
  }
}

/**
 * AiToolkitAPI — the single entry point for all AI interactions with an editor.
 *
 * Obtain via:
 *   import { getAiToolkit } from "@scrivr/plugins";
 *   const ai = getAiToolkit(editor);
 *
 * Never instantiate directly — created by AiToolkit.onEditorReady().
 */
/** Distinguish a whole `SemanticUnit` (has `nodeIds[]`) from a `RichBlockEdit` (has `nodeId`). */
function isSemanticUnit(item: RichBlockEdit | SemanticUnit): item is SemanticUnit {
  return "nodeIds" in item && Array.isArray(item.nodeIds);
}

/**
 * Validated spans (zod: `attrs?: T | undefined`) → core `InlineSpan`s
 * (`exactOptionalPropertyTypes`-clean: omit `attrs` when absent). Runtime data
 * is identical; this only reconciles the optional-property types across the
 * zod ↔ core boundary.
 */
function toCoreSpans(spans: EditInlineSpan[]): InlineSpan[] {
  return spans.map((span) => ({
    text: span.text,
    marks: span.marks.map((mark) => (mark.attrs !== undefined ? { type: mark.type, attrs: mark.attrs } : { type: mark.type })),
  }));
}

/** A caller-pinned source hash on a unit (optional stale-edit guard). */
function sourceHashOf(item: SemanticUnit): string | undefined {
  return readStringField(item, "expectedContentHash") ?? readStringField(item, "richHash");
}

function editForPart(part: SemanticPart): RichBlockEdit {
  return {
    nodeId: part.nodeId,
    spans: part.spans ?? [{ text: part.text, marks: [] }],
    ...(part.attrs ? { attrs: part.attrs } : {}),
  };
}

function readStringField(item: unknown, key: string): string | undefined {
  if (!item || typeof item !== "object" || !(key in item)) return undefined;
  const value = (item as Record<string, unknown>)[key]; // guarded cast after typeof + in
  return typeof value === "string" ? value : undefined;
}

export class AiToolkitAPI {
  /**
   * AI suggestion overlay API.
   * null if the AiSuggestion extension was not included (aiSuggestion: false).
   */
  readonly suggestions: AiSuggestionsAPI | null;

  constructor(private readonly editor: IBaseEditor, hasSuggestion: boolean) {
    this.suggestions = hasSuggestion ? new AiSuggestionsAPI(editor) : null;
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  /**
   * Returns plain text for a document position range.
   * Block boundaries are joined with a newline.
   */
  getTextRange(from: number, to: number): string {
    const doc = this.editor.getState().doc;
    return doc.textBetween(
      Math.max(0, from),
      Math.min(doc.content.size, to),
      "\n",
    );
  }

  /**
   * Returns Markdown for a document position range.
   * Serializes the whole document, then extracts the section corresponding
   * to the plain-text content of the range. Falls back to plain text if the
   * markdown extraction heuristic fails.
   */
  getMarkdownRange(from: number, to: number): string {
    const doc  = this.editor.getState().doc;
    const size = doc.content.size;
    const f    = Math.max(0, from);
    const t    = Math.min(size, to);

    const rangeText = doc.textBetween(f, t, "\n");
    if (!rangeText) return "";

    const full = this.editor.getMarkdown();

    // Find the range text inside the serialized markdown
    const idx = full.indexOf(rangeText);
    if (idx >= 0) return full.slice(idx, idx + rangeText.length);

    // Fallback: plain text
    return rangeText;
  }

  /**
   * Returns text context around the current cursor — before, selection, after.
   * Useful for constructing AI prompts that need document context.
   */
  getContext(options?: {
    beforeChars?:      number;
    afterChars?:       number;
    includeSelection?: boolean;
  }): {
    before:      string;
    after:       string;
    selection:   string;
    cursorPos:   number;
    totalLength: number;
  } {
    const {
      beforeChars      = 2000,
      afterChars       = 500,
      includeSelection = true,
    } = options ?? {};

    const doc     = this.editor.getState().doc;
    const { from, to } = this.editor.getState().selection;
    const docSize = doc.content.size;

    return {
      before:      doc.textBetween(Math.max(0, from - beforeChars), from, "\n"),
      after:       doc.textBetween(to, Math.min(docSize, to + afterChars), "\n"),
      selection:   includeSelection ? doc.textBetween(from, to, "\n") : "",
      cursorPos:   from,
      totalLength: docSize,
    };
  }

  /**
   * Splits the full Markdown document into chunks of at most `chunkSize` chars.
   * Use this to feed large documents to AI models with limited context windows.
   */
  getTextChunks(chunkSize: number): string[] {
    const full    = this.editor.getMarkdown();
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += chunkSize) {
      chunks.push(full.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Returns a human-readable description of the active document schema.
   * Include this in AI system prompts so the model knows what content is valid.
   *
   * @example
   * const { nodes, marks } = ai.getSchemaDescription();
   * // nodes: [{ name: "paragraph", isBlock: true, attrs: ["align"] }, ...]
   */
  getSchemaDescription(): {
    nodes: Array<{ name: string; isBlock: boolean; attrs: string[] }>;
    marks: Array<{ name: string; attrs: string[] }>;
  } {
    const schema = this.editor.getState().schema as Schema;

    const nodes = Object.entries(schema.nodes)
      .filter(([name]) => name !== "doc" && name !== "text")
      .map(([name, type]) => ({
        name,
        isBlock: type.isBlock,
        // Strip internal attrs that AI shouldn't know about
        attrs: Object.keys(type.spec.attrs ?? {}).filter(
          (a) => a !== "nodeId" && a !== "dataTracked",
        ),
      }));

    const marks = Object.entries(schema.marks).map(([name, type]) => ({
      name,
      attrs: Object.keys(type.spec.attrs ?? {}),
    }));

    return { nodes, marks };
  }

  /**
   * Returns the accepted text of every top-level block in the document,
   * each paired with its stable nodeId.
   *
   * "Accepted text" means pending deletions are excluded and pending insertions
   * are included — exactly what a human reader sees. This is what you should
   * send to the LLM as document context.
   *
   * Pass `from` / `to` to restrict to blocks that overlap a doc position range
   * (e.g. the current selection). Omit both to get all blocks.
   *
   * Blocks without a nodeId (e.g. imported docs that predate UniqueId) are
   * silently skipped — they cannot be targeted by applyMultiBlockDiff anyway.
   *
   * @example
   * // Full document
   * const blocks = ai.getBlocks();
   *
   * // Current selection only
   * const { from, to } = editor.getState().selection;
   * const blocks = ai.getBlocks(from, to);
   */
  getBlocks(from?: number, to?: number): Array<{ nodeId: string; text: string }> {
    const state  = this.editor.getState();
    const schema = state.schema as Schema;
    const blocks: Array<{ nodeId: string; text: string }> = [];

    state.doc.forEach((node, offset) => {
      const nodeStart = offset;
      const nodeEnd   = offset + node.nodeSize;

      // If a range was given, skip blocks that don't overlap it.
      if (from !== undefined && to !== undefined) {
        if (nodeEnd <= from || nodeStart >= to) return;
      }

      const nodeId = node.attrs["nodeId"] as string | null | undefined;
      if (!nodeId) return;

      const { acceptedText } = buildAcceptedTextMap(node, offset, schema);
      if (acceptedText) blocks.push({ nodeId, text: acceptedText });
    });

    return blocks;
  }

  // ── Rich (formatting-aware) API ──────────────────────────────────────────────

  /**
   * Like `getBlocks`, but each block is a full `SemanticUnit` carrying its
   * inline formatting (`spans`) and block styling (`attrs`) — the rich context
   * an agent needs to see and preserve formatting. Emits ONE unit per top-level
   * block (grouping bypassed) so the edit round-trips mechanically; container
   * units still expose their inner leaves via `parts`.
   *
   * Pass `from` / `to` to restrict to blocks overlapping a position range.
   *
   * @example
   * const units = ai.getRichBlocks();
   * const edited = await llm.rewrite(units); // returns edited units
   * ai.applyRichEdit(edited);
   */
  getRichBlocks(from?: number, to?: number): SemanticUnit[] {
    const units = toSemanticUnits(this.editor, { groupBlocks: false });
    if (from === undefined || to === undefined) return units;
    const allowed = new Set(this.getBlocks(from, to).map((b) => b.nodeId));
    return units.filter((u) => allowed.has(u.id));
  }

  /**
   * Apply the agent's rich edits as tracked-change suggestions, preserving
   * untouched formatting.
   *
   * Accepts either explicit `RichBlockEdit`s (`{ nodeId, spans?, attrs? }`) or
   * whole edited `SemanticUnit`s — the latter are auto-diffed against the live
   * document via `unitRichHash`, so the model never states which blocks changed
   * (unchanged units are skipped). A `RichBlockEdit.expectedContentHash` (or a
   * unit whose source hash the caller pins) is the stale-edit guard: if the
   * block's current rich hash differs, the edit is skipped as `stale` rather
   * than clobbering newer content.
   *
   * v1 is suggestions-only; `asSuggestion: false` (direct apply) is reserved.
   */
  applyRichEdit(
    edits: RichBlockEdit[] | SemanticUnit[],
    options: { authorID?: string; asSuggestion?: boolean } = {},
  ): { applied: boolean; changed: string[]; stale: string[]; notFound: string[]; rejected: string[] } {
    const authorID = options.authorID ?? "AI Assistant";

    // Current rich hash per block — the freshness base for both auto-diff
    // (which units changed) and the stale guard (did the doc move under us).
    const currentUnits = new Map<string, SemanticUnit>();
    const currentHashByNodeId = new Map<string, string>();
    for (const u of toSemanticUnits(this.editor, { groupBlocks: false })) {
      currentUnits.set(u.id, u);
      currentHashByNodeId.set(u.id, unitRichHash(u));
      for (const part of u.parts ?? []) {
        currentHashByNodeId.set(part.nodeId, semanticPartRichHash(part));
      }
    }

    const resolved: RichBlockEdit[] = [];
    const changed: string[] = [];
    const stale: string[] = [];
    const notFound: string[] = [];

    for (const item of edits) {
      if (isSemanticUnit(item)) {
        const nodeId = item.nodeIds[0];
        if (!nodeId) continue;
        const currentUnit = currentUnits.get(nodeId);
        if (currentUnit === undefined) {
          notFound.push(nodeId);
          continue;
        }
        const current = unitRichHash(currentUnit);
        const sourceHash = sourceHashOf(item);
        if (sourceHash !== undefined && sourceHash !== current) {
          stale.push(nodeId);
          continue;
        }
        if (unitRichHash(item) === current) continue; // unchanged — skip

        // Container units are context envelopes; their individually-addressable
        // parts are the edit surface. Diff those leaves and never send the
        // container itself to the leaf-only merge engine.
        if (item.parts || currentUnit.parts) {
          const currentParts = new Map((currentUnit.parts ?? []).map((part) => [part.nodeId, part]));
          for (const part of item.parts ?? []) {
            const currentPart = currentParts.get(part.nodeId);
            if (!currentPart) {
              notFound.push(part.nodeId);
              continue;
            }
            if (semanticPartRichHash(part) === semanticPartRichHash(currentPart)) continue;
            resolved.push(editForPart(part));
            changed.push(part.nodeId);
          }
          continue;
        }

        changed.push(nodeId);
        // A plain-text edit has no `spans`; synthesize one unformatted run so
        // the inline diff still sees the new text.
        resolved.push({
          nodeId,
          spans: item.spans ?? [{ text: item.text, marks: [] }],
          ...(item.attrs ? { attrs: item.attrs } : {}),
          expectedContentHash: sourceHash ?? current,
        });
      } else {
        if (item.expectedContentHash !== undefined && currentHashByNodeId.get(item.nodeId) !== item.expectedContentHash) {
          stale.push(item.nodeId);
          continue;
        }
        resolved.push(item);
        changed.push(item.nodeId);
      }
    }

    if (resolved.length === 0) return { applied: false, changed, stale, notFound, rejected: [] };

    const result = applyRichDiffAsSuggestion(
      this.editor.getState(),
      (tr) => this.editor.applyTransaction(tr),
      { edits: resolved, authorID },
    );
    return {
      applied: result.applied,
      changed,
      stale,
      notFound: [...notFound, ...result.notFound],
      rejected: result.rejected,
    };
  }

  /**
   * Apply zod-validated protocol edits (from `parseRichEdits` /
   * `SemanticEditSchema`). The typed entry point for the public edit protocol:
   * parse untrusted agent output, then hand the validated edits here.
   *
   * Phase 1 handles `richText` (inline). Unsupported kinds (the structural ops
   * specced for later phases) are returned in `unsupported` rather than applied.
   */
  applySemanticEdits(
    edits: SemanticEdit[],
    options: { authorID?: string; asSuggestion?: boolean } = {},
  ): { applied: boolean; changed: string[]; stale: string[]; notFound: string[]; rejected: string[]; unsupported: string[] } {
    const rich: RichBlockEdit[] = [];
    const unsupported: string[] = [];
    for (const edit of edits) {
      // Phase 1: only `richText`. Structural ops join `SemanticEdit` in later
      // phases and route to a dedicated adapter here (→ `unsupported` until then).
      if (edit.kind === "richText") {
        rich.push({
          nodeId: edit.nodeId,
          ...(edit.spans ? { spans: toCoreSpans(edit.spans) } : {}),
          ...(edit.attrs ? { attrs: edit.attrs } : {}),
          ...(edit.expectedContentHash ? { expectedContentHash: edit.expectedContentHash } : {}),
        });
      }
    }
    const result = this.applyRichEdit(rich, options);
    return { ...result, unsupported };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  /**
   * Streams content cosmetically as ghost text after the anchor block.
   * The document is NOT modified during streaming — this is purely visual.
   *
   * Returns the full accumulated text when the stream ends.
   * Dispatches are debounced to at most one per animation frame (16ms) to
   * avoid per-token repaints during fast LLM streams.
   *
   * @param nodeId  The stable nodeId of the block to append ghost text after
   * @param stream  An AsyncIterable of text chunks (e.g. from a fetch SSE stream)
   */
  async streamGhostText(
    nodeId: string,
    stream: AsyncIterable<string>,
  ): Promise<string> {
    const editor = this.editor;
    let accumulated = "";

    // Position the AI caret at the end of the anchor block
    const found = findNodeById(editor.getState().doc, nodeId);
    if (found) {
      const endPos = found.pos + found.node.nodeSize;
      editor.applyTransaction(
        editor.getState().tr
          .setMeta(aiCaretPluginKey, { position: endPos })
          .setMeta("addToHistory", false),
      );
    }

    // Debounce: batch chunk updates into animation frames
    let pendingDispatch = false;

    const flush = () => {
      pendingDispatch = false;
      editor.applyTransaction(
        editor.getState().tr
          .setMeta(ghostTextPluginKey, { nodeId, content: accumulated })
          .setMeta("addToHistory", false),
      );
    };

    try {
      for await (const chunk of stream) {
        accumulated += chunk;
        if (!pendingDispatch) {
          pendingDispatch = true;
          // Schedule a flush at the next animation frame
          if (typeof requestAnimationFrame !== "undefined") {
            requestAnimationFrame(flush);
          } else {
            // Node.js / test environment fallback
            setTimeout(flush, 16);
          }
        }
      }

      // Ensure final state is dispatched after stream ends
      flush();
    } catch (err) {
      this.clearGhostText();
      this.clearAiCaret();
      throw err;
    }

    return accumulated;
  }

  /** Clear the ghost text decoration immediately. */
  clearGhostText(): void {
    this.editor.applyTransaction(
      this.editor.getState().tr
        .setMeta(ghostTextPluginKey, { nodeId: null, content: "" })
        .setMeta("addToHistory", false),
    );
  }

  /** Clear the AI caret decoration immediately. */
  clearAiCaret(): void {
    this.editor.applyTransaction(
      this.editor.getState().tr
        .setMeta(aiCaretPluginKey, { position: null })
        .setMeta("addToHistory", false),
    );
  }

  /**
   * Stream ghost text cosmetically, then commit the result as a tracked change
   * (or direct insert if TrackChanges is not active). This is the primary
   * method for AI-generated content.
   *
   * Flow:
   *   1. Cosmetic streaming → ghost text grows, AI caret pulses
   *   2. Stream ends → ghost text cleared, AI caret cleared
   *   3. Content inserted after anchor block as a real document transaction
   *      tagged with `track-author` so TrackChanges (Phase 4) wraps it
   *
   * @param nodeId   Anchor block to insert content after
   * @param stream   AsyncIterable of text chunks
   * @param authorId Defaults to "ai:assistant" — used for TrackChanges attribution
   */
  async generateSuggestion(
    nodeId: string,
    stream: AsyncIterable<string>,
    options?: { authorId?: string },
  ): Promise<void> {
    const authorId = options?.authorId ?? "ai:assistant";

    // Phase 1: stream cosmetically
    const generated = await this.streamGhostText(nodeId, stream);

    // Phase 2: clear cosmetic overlays
    this.clearGhostText();
    this.clearAiCaret();

    if (!generated) return;

    // Phase 3: atomic insert tagged for TrackChanges (Phase 4)
    const state = this.editor.getState();
    const found = findNodeById(state.doc, nodeId);
    if (!found) return;

    const schema = state.schema as Schema;
    const paragraphType = schema.nodes["paragraph"];
    if (!paragraphType) return;

    // Insert a new paragraph with the generated text after the anchor block
    const insertPos = found.pos + found.node.nodeSize;
    const newNode   = paragraphType.createAndFill(
      {},
      schema.text(generated),
    );
    if (!newNode) return;

    const tr = state.tr
      .insert(insertPos, newNode)
      .setMeta("track-author", authorId)  // TrackChanges (Phase 4) reads this
      .scrollIntoView();

    this.editor.applyTransaction(tr);
  }
}

// ── AiToolkitOptions ─────────────────────────────────────────────────────────

interface AiToolkitOptions {
  /** Set false to exclude the UniqueId sub-extension. Default: true. */
  uniqueId?: false;
  /** Set false to exclude the GhostText sub-extension. Default: true. */
  ghostText?: false;
  /** Set false to exclude the AiCaret sub-extension. Default: true. */
  aiCaret?: false;
  /** Set false to exclude the AiSuggestion sub-extension. Default: true. */
  aiSuggestion?: false;
}

// ── AiToolkit extension ───────────────────────────────────────────────────────

/**
 * AiToolkit — opt-in extension that bundles UniqueId, GhostText, and AiCaret,
 * and exposes the AiToolkitAPI via getAiToolkit().
 *
 * Add this to your extensions array to enable AI capabilities:
 *
 * @example
 * import { StarterKit, AiToolkit } from "@scrivr/core";
 * import { getAiToolkit } from "@scrivr/core";
 *
 * const editor = new Editor({ extensions: [StarterKit, AiToolkit] });
 * const ai = getAiToolkit(editor);
 *
 * // Stream AI content
 * await ai.generateSuggestion(nodeId, myStream);
 *
 * // Read document context
 * const ctx = ai.getContext({ beforeChars: 1000 });
 */
export const AiToolkit = Extension.create<AiToolkitOptions>({
  name: "aiToolkit",

  addProseMirrorPlugins() {
    const plugins = [];
    if (this.options.uniqueId !== false) {
      plugins.push(...UniqueId.resolve(this.schema).plugins);
    }
    if (this.options.ghostText !== false) {
      plugins.push(...GhostText.resolve(this.schema).plugins);
    }
    if (this.options.aiCaret !== false) {
      plugins.push(...AiCaret.resolve(this.schema).plugins);
    }
    if (this.options.aiSuggestion !== false) {
      plugins.push(...AiSuggestionExtension.resolve(this.schema).plugins);
    }
    return plugins;
  },

  addCommands() {
    const cmds: Record<string, (...args: unknown[]) => Command> = {};
    if (this.options.ghostText !== false) {
      Object.assign(cmds, GhostText.resolve(this.schema).commands);
    }
    if (this.options.aiCaret !== false) {
      Object.assign(cmds, AiCaret.resolve(this.schema).commands);
    }
    return cmds;
  },

  onEditorReady(editor: IBaseEditor) {
    // The AiToolkitAPI only needs `IBaseEditor` methods (getState,
    // applyTransaction, getMarkdown, schema), so register it here — fires in
    // both the browser `Editor` and headless `ServerEditor`. Overlay painting
    // is wired separately in `onViewReady` (view-only).
    const hasSuggestion = this.options.aiSuggestion !== false;
    const api = new AiToolkitAPI(editor, hasSuggestion);
    aiToolkitRegistry.set(editor, api);

    return () => {
      aiToolkitRegistry.delete(editor);
    };
  },

  onViewReady(editor: IEditor) {
    // The sub-extensions (GhostText / AiCaret / AiSuggestion) are all
    // view-only — they paint overlays. Compose their `viewReadyCallback`s
    // here so the consumer registers them transitively without having to
    // list each in the extensions array.
    const cleanups: Array<() => void> = [];

    if (this.options.ghostText !== false) {
      const cleanup = GhostText.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }
    if (this.options.aiCaret !== false) {
      const cleanup = AiCaret.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }
    if (this.options.aiSuggestion !== false) {
      const cleanup = AiSuggestionExtension.resolve().viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }

    return () => {
      cleanups.forEach((c) => c());
    };
  },
});
