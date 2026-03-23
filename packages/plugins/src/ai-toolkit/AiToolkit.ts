import { Extension } from "@inscribe/core";
import type { IEditor } from "@inscribe/core";
import { UniqueId } from "./UniqueId";
import { GhostText, ghostTextPluginKey } from "./GhostText";
import { AiCaret, aiCaretPluginKey } from "./AiCaret";
import { findNodeById } from "./UniqueId";
import { aiToolkitRegistry } from "./aiToolkitRegistry";
import { buildAcceptedTextMap } from "../track-changes/lib/acceptedTextMap";
import type { Schema } from "prosemirror-model";
import type { Command } from "prosemirror-state";

// ── AiToolkitAPI ─────────────────────────────────────────────────────────────

/**
 * AiToolkitAPI — the single entry point for all AI interactions with an editor.
 *
 * Obtain via:
 *   import { getAiToolkit } from "@inscribe/core";
 *   const ai = getAiToolkit(editor);
 *
 * Never instantiate directly — created by AiToolkit.onEditorReady().
 */
export class AiToolkitAPI {
  constructor(private readonly editor: IEditor) {}

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
      editor._applyTransaction(
        editor.getState().tr
          .setMeta(aiCaretPluginKey, { position: endPos })
          .setMeta("addToHistory", false),
      );
    }

    // Debounce: batch chunk updates into animation frames
    let pendingDispatch = false;

    const flush = () => {
      pendingDispatch = false;
      editor._applyTransaction(
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
    this.editor._applyTransaction(
      this.editor.getState().tr
        .setMeta(ghostTextPluginKey, { nodeId: null, content: "" })
        .setMeta("addToHistory", false),
    );
  }

  /** Clear the AI caret decoration immediately. */
  clearAiCaret(): void {
    this.editor._applyTransaction(
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

    this.editor._applyTransaction(tr);
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
}

// ── AiToolkit extension ───────────────────────────────────────────────────────

/**
 * AiToolkit — opt-in extension that bundles UniqueId, GhostText, and AiCaret,
 * and exposes the AiToolkitAPI via getAiToolkit().
 *
 * Add this to your extensions array to enable AI capabilities:
 *
 * @example
 * import { StarterKit, AiToolkit } from "@inscribe/core";
 * import { getAiToolkit } from "@inscribe/core";
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

  onEditorReady(editor: IEditor) {
    const cleanups: Array<() => void> = [];

    // Register sub-extension overlay handlers
    if (this.options.ghostText !== false) {
      const cleanup = GhostText.resolve().editorReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }
    if (this.options.aiCaret !== false) {
      const cleanup = AiCaret.resolve().editorReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }

    // Create and register the AiToolkitAPI instance
    const api = new AiToolkitAPI(editor);
    aiToolkitRegistry.set(editor, api);

    return () => {
      cleanups.forEach((c) => c());
      aiToolkitRegistry.delete(editor);
    };
  },
});
