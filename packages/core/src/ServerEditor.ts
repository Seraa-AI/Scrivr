import { EditorState, Transaction } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";

import type { Extension } from "./extensions/Extension";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import type { IEditor, OverlayRenderHandler } from "./extensions/types";
import type { DocumentLayout } from "./layout/PageLayout";

export interface ServerEditorOptions {
  /**
   * Extensions that define the schema and plugins (same as the client Editor).
   * Omit rendering-only extensions (e.g. Collaboration cursor) — they're ignored gracefully.
   * Defaults to [StarterKit].
   */
  extensions?: Extension[];
  /**
   * Optional initial document as a ProseMirror JSON object.
   * If omitted the editor starts with an empty document.
   */
  content?: Record<string, unknown>;
}

/**
 * ServerEditor — a headless document engine that runs in Node.js (or any
 * non-browser environment) without any DOM, canvas, or input dependencies.
 *
 * It shares the same extension system and ProseMirror schema as the client
 * Editor, so plugins like TrackChanges work identically on both sides.
 *
 * Typical server-side workflow:
 *   1. Load document JSON from your database.
 *   2. Create a ServerEditor with the document and relevant extensions.
 *   3. Apply transactions (e.g. AI suggestions tagged with "aiSuggestAs").
 *   4. Export the modified document back to JSON and persist it.
 *
 * @example
 *   import { ServerEditor } from "@inscribe/core";
 *   import { TrackChanges } from "@inscribe/plugins";
 *
 *   const editor = new ServerEditor({
 *     extensions: [StarterKit, TrackChanges.configure({ userID: "server", canAcceptReject: true })],
 *     content: docFromDb,
 *   });
 *
 *   // Apply an AI suggestion as a tracked change
 *   const { from } = editor.getState().selection;
 *   const tr = editor.getState().tr.insertText("Hello world", from);
 *   tr.setMeta("aiSuggestAs", "AI Assistant");
 *   editor.applyTransaction(tr);
 *
 *   const updatedDoc = editor.toJSON();
 */
export class ServerEditor implements IEditor {
  private readonly manager: ExtensionManager;
  private state: EditorState;

  constructor({ extensions = [StarterKit], content }: ServerEditorOptions = {}) {
    this.manager = new ExtensionManager(extensions);

    let doc: PMNode | undefined;
    if (content) {
      doc = this.manager.schema.nodeFromJSON(content);
    }

    this.state = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
      ...(doc ? { doc } : {}),
    });
  }

  /** The merged ProseMirror schema (same as the client Editor). */
  get schema() {
    return this.manager.schema;
  }

  /** Current ProseMirror state. */
  getState(): EditorState {
    return this.state;
  }

  /**
   * Replace the document with a new one from ProseMirror JSON.
   * All plugin state (including TrackChanges) is re-initialised.
   */
  setContent(json: Record<string, unknown>): void {
    const doc = this.manager.schema.nodeFromJSON(json);
    this.state = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
      doc,
    });
  }

  /**
   * Apply a ProseMirror transaction.
   * Plugins (e.g. TrackChanges) run their appendTransaction hooks as normal.
   */
  applyTransaction(tr: Transaction): void {
    this.state = this.state.apply(tr);
  }

  /** Serialize the document to ProseMirror JSON. */
  toJSON(): Record<string, unknown> {
    return this.state.doc.toJSON() as Record<string, unknown>;
  }

  /** Plain text content of the document. */
  getText(): string {
    return this.state.doc.textContent;
  }

  /** Serialize the document to Markdown. */
  getMarkdown(): string {
    const { nodes, marks } = this.manager.buildMarkdownSerializerRules();
    const serializer = new MarkdownSerializer(nodes, marks);
    return serializer.serialize(this.state.doc);
  }

  // ── IEditor stubs — no visual surface on the server ────────────────────────

  /** No-op: ServerEditor has no subscribers. */
  subscribe(_listener: () => void): () => void {
    return () => {};
  }

  /** No-op: ServerEditor has no overlay canvas. */
  addOverlayRenderHandler(_handler: OverlayRenderHandler): () => void {
    return () => {};
  }

  /** Not available server-side — throws if called. */
  get layout(): DocumentLayout {
    throw new Error("layout is not available on ServerEditor");
  }

  /** Not available server-side — always returns null. */
  getViewportRect(_from: number, _to: number): DOMRect | null {
    return null;
  }

  /** Not available server-side — always returns null. */
  getNodeViewportRect(_docPos: number): DOMRect | null {
    return null;
  }

  /** Not available server-side — no-op. */
  selectNode(_docPos: number): void {}

  /** Not available server-side — no-op. */
  setNodeAttrs(_docPos: number, _attrs: Record<string, unknown>): void {}


  /**
   * Apply a transaction from an external source.
   * Alias of applyTransaction — satisfies IEditor._applyTransaction.
   */
  _applyTransaction(tr: Transaction): void {
    this.applyTransaction(tr);
  }

  /** No-op: ServerEditor has no renderer to redraw. */
  redraw(): void {}

  /** No-op: ServerEditor has no renderer to redraw. */
  setReady(ready: boolean): void {}

  /** No-op: ServerEditor has no renderer to redraw. */
  get loadingState(): "syncing" | "rendering" | "ready" {
    return "ready";
  }
}
