import { EditorState, Transaction } from "prosemirror-state";
import { MarkdownSerializer } from "prosemirror-markdown";
import type { Schema, Node } from "prosemirror-model";

import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import type { IBaseEditor } from "./extensions/types";
import type { ExportContributionMap } from "./extensions/export";
import type { SafeFlatCommands, EditorEvents, ExtensionStorage } from "./types/augmentation";
import { parseMarkdownToDoc } from "./model/parseMarkdown";

export interface BaseEditorOptions {
  /**
   * Extensions that define the schema, plugins, and commands.
   * Defaults to [StarterKit].
   */
  extensions?: Extension[];
  /**
   * Optional initial document. Strings are parsed as markdown using the
   * merged token map from all extensions; objects are parsed as ProseMirror
   * JSON. If omitted, falls back to extensions' `addInitialDoc` (e.g.
   * `DefaultContent`), then the schema default empty document.
   *
   * Per-instance precedence: this option overrides any extension's
   * `addInitialDoc` contribution.
   */
  content?: string | Record<string, unknown>;
}

/**
 * BaseEditor — the headless core shared by `Editor` (browser) and
 * `ServerEditor` (Node.js / tests).
 *
 * Owns:
 *   - The ExtensionManager (schema, plugins, commands)
 *   - The ProseMirror EditorState
 *   - The typed event emitter (on/off/emit)
 *   - The subscriber set (subscribe / notifyListeners)
 *   - Commands and storage
 *
 * Does NOT own:
 *   - Layout (LayoutCoordinator) — view only
 *   - Canvas rendering / overlay handlers — view only
 *   - Input capture (InputBridge / textarea) — view only
 *   - Cursor blink timer (CursorManager) — view only
 *
 * Subclasses call `_fireEditorReady()` at the END of their own constructor
 * once all infrastructure (including view infrastructure for `Editor`) is set up.
 */
export class BaseEditor implements IBaseEditor {
  protected readonly manager: ExtensionManager;
  /**
   * The root editor's state.
   *
   * Root-is-identity invariant (load-bearing): this field MUST always
   * reference the root editor document. Never reassign it to an active
   * EditorSurface's state. Input routing is re-targeted at the Editor level
   * via wrapped `getState` callbacks; document identity lives here and must
   * not move. Save hooks, commands, subscribers, and collaborative adapters
   * all read through this — if it ever points at a surface they silently
   * target the wrong document.
   */
  protected editorState: EditorState;

  private readOnlyValue = false;
  private readonly listeners = new Set<() => void>();

  /**
   * Bound command map. Type is `SafeFlatCommands` — augment
   * `Commands<ReturnType>` in your extension to get typed entries.
   */
  readonly commands: SafeFlatCommands;

  /**
   * Per-extension storage. Augment `ExtensionStorage` in your extension
   * to get typed entries.
   */
  readonly storage: ExtensionStorage = {} as ExtensionStorage;

  private readonly eventHandlers = new Map<
    keyof EditorEvents,
    Set<(payload: EditorEvents[keyof EditorEvents]) => void>
  >();

  /**
   * Cleanup functions registered by `onEditorReady` and (in `Editor`)
   * `onViewReady`. Run in registration order on `destroy()`. Subclasses
   * push into this array when they fire their own lifecycle hooks.
   */
  protected runtimeCleanup: Array<() => void> = [];

  constructor({ extensions = [StarterKit], content }: BaseEditorOptions = {}) {
    this.manager = new ExtensionManager(extensions);

    const initialDoc =
      typeof content === "string"
        ? parseMarkdownToDoc(
            this.manager.schema,
            this.manager.buildMarkdownParserTokens(),
            content,
          )
        : content != null
          ? this.manager.schema.nodeFromJSON(content)
          : this.manager.buildInitialDoc();

    this.editorState = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
      ...(initialDoc ? { doc: initialDoc } : {}),
    });

    this.commands = this.buildCommands();
  }

  /** The merged ProseMirror Schema built from all extensions. */
  get schema(): Schema {
    return this.manager.schema;
  }

  getState(): EditorState {
    return this.editorState;
  }

  /** True when the editor is in read-only / view mode. */
  get readOnly(): boolean {
    return this.readOnlyValue;
  }

  /**
   * Enable or disable read-only mode. When true, all document mutations are
   * blocked and the cursor is hidden. Notifies subscribers so UI can react.
   *
   * Subclasses (Editor) override this to also gate InputBridge + CursorManager.
   */
  setReadOnly(value: boolean): void {
    if (this.readOnlyValue === value) return;
    this.readOnlyValue = value;
    this.notifyListeners();
  }

  /** Merge attrs into the node at docPos. No-op if no node exists there. */
  setNodeAttrs(docPos: number, attrs: Record<string, unknown>): void {
    const node = this.editorState.doc.nodeAt(docPos);
    if (!node) return;
    this.applyTransaction(
      this.editorState.tr.setNodeMarkup(docPos, undefined, { ...node.attrs, ...attrs }),
    );
  }

  /**
   * Apply a ProseMirror transaction through the full dispatch pipeline.
   *
   * Use this for any state mutation not covered by commands — e.g. plugin
   * metadata via `tr.setMeta()`, programmatic `deleteSelection`, custom
   * transforms, or external sources (Y.js remote sync, AI suggestions).
   * The transaction goes through the same path as command-dispatched
   * transactions: plugin appendTransaction hooks run, layout is invalidated,
   * subscribers are notified, and (in `Editor`) a render flush is scheduled.
   *
   * Subclasses override this to layer view side-effects on top (Editor's
   * override routes through the view-aware dispatch). `BaseEditor`'s
   * implementation runs the headless apply pipeline only.
   */
  applyTransaction(tr: Transaction): void {
    this.applyState(tr);
  }

  getMarkdown(): string {
    return this.getMarkdownSerializer().serialize(this.editorState.doc);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Register a typed event handler. Returns an unsubscribe function.
   *
   * @example
   * const off = editor.on("update", ({ docChanged }) => { ... });
   */
  on<K extends keyof EditorEvents>(
    event: K,
    handler: (payload: EditorEvents[K]) => void,
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    const handlers = this.eventHandlers.get(event)!;
    handlers.add(handler as (p: EditorEvents[keyof EditorEvents]) => void);
    return () => this.off(event, handler);
  }

  /** Unregister a typed event handler. */
  off<K extends keyof EditorEvents>(
    event: K,
    handler: (payload: EditorEvents[K]) => void,
  ): void {
    this.eventHandlers
      .get(event)
      ?.delete(handler as (p: EditorEvents[keyof EditorEvents]) => void);
  }

  /** Emit a typed editor event. Called internally — extensions may also call this. */
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    this.eventHandlers.get(event)?.forEach((h) => h(payload));
  }

  getExportContributions(): ExportContributionMap[] {
    return this.manager.getExportContributions();
  }

  getMarkdownSerializer(): MarkdownSerializer {
    const { nodes, marks } = this.manager.buildMarkdownSerializerRules();
    return new MarkdownSerializer(nodes, marks);
  }

  /** Returns the merged markdown parser token map from all extensions. */
  getMarkdownParserTokens(): Record<string, import("./extensions/types").MarkdownParserTokenSpec> {
    return this.manager.buildMarkdownParserTokens();
  }

  /**
   * Parse a markdown string into a ProseMirror document node.
   *
   * Uses the same parser tokens registered by extensions via
   * `addMarkdownParserTokens()`, so all custom node/mark mappings
   * are included automatically.
   */
  parseMarkdown(text: string): Node {
    return parseMarkdownToDoc(this.schema, this.getMarkdownParserTokens(), text);
  }

  /** Plain text content of the document. */
  getText(): string {
    return this.editorState.doc.textContent;
  }

  /** Serialize the document to ProseMirror JSON. */
  toJSON(): Record<string, unknown> {
    return this.editorState.doc.toJSON() as Record<string, unknown>;
  }

  /**
   * Returns the names of marks active at the current cursor/selection.
   *
   * - Collapsed cursor: uses stored marks or the marks of the text node before the cursor.
   * - Range selection: a mark is active only if it spans every text node in the range.
   */
  getActiveMarks(): string[] {
    const state = this.getActiveState();
    const { selection, storedMarks } = state;
    const { from, to, empty } = selection;

    if (empty) {
      const marks = storedMarks ?? selection.$from.marks();
      return marks.map((m) => m.type.name);
    }

    return Object.keys(this.schema.marks).filter((name) => {
      const markType = this.schema.marks[name]!;
      let hasText = false;
      let allHaveMark = true;
      state.doc.nodesBetween(from, to, (node) => {
        if (node.isText) {
          hasText = true;
          if (!markType.isInSet(node.marks)) allHaveMark = false;
        }
      });
      return hasText && allHaveMark;
    });
  }

  /**
   * Attributes of each active mark at the current cursor/selection.
   * For a range selection, only marks active across the entire range are included.
   */
  getActiveMarkAttrs(): Record<string, Record<string, unknown>> {
    const state = this.getActiveState();
    const { selection, storedMarks } = state;
    const { from, to, empty } = selection;
    const result: Record<string, Record<string, unknown>> = {};

    if (empty) {
      const marks = storedMarks ?? selection.$from.marks();
      for (const mark of marks) {
        result[mark.type.name] = mark.attrs as Record<string, unknown>;
      }
    } else {
      for (const name of this.getActiveMarks()) {
        const markType = this.schema.marks[name]!;
        state.doc.nodesBetween(from, to, (node) => {
          if (node.isText && !(name in result)) {
            const found = markType.isInSet(node.marks);
            if (found) result[name] = found.attrs as Record<string, unknown>;
          }
        });
      }
    }

    return result;
  }

  getBlockInfo(): { blockType: string; blockAttrs: Record<string, unknown> } {
    const { $from } = this.getActiveState().selection;
    for (let d = 1; d <= $from.depth; d++) {
      const node = $from.node(d);
      if (node.isBlock && d === 1) {
        return {
          blockType: node.type.name,
          blockAttrs: node.attrs as Record<string, unknown>,
        };
      }
    }
    return {
      blockType: $from.parent.type.name,
      blockAttrs: $from.parent.attrs as Record<string, unknown>,
    };
  }

  /**
   * Returns true when the named mark or block type is active at the cursor.
   * Mirrors TipTap's `editor.isActive()` signature.
   */
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    if (this.schema.marks[name]) {
      const active = this.getActiveMarks().includes(name);
      if (!active || !attrs) return active;
      const ma = this.getActiveMarkAttrs()[name];
      if (!ma) return false;
      return Object.entries(attrs).every(([k, v]) => ma[k] === v);
    }
    const { blockType, blockAttrs } = this.getBlockInfo();
    if (blockType !== name) return false;
    if (!attrs) return true;
    return Object.entries(attrs).every(([k, v]) => blockAttrs[k] === v);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  destroy(): void {
    this.emit("destroy", undefined as EditorEvents["destroy"]);
    // Tear down in reverse of setup so view cleanup (which may read engine
    // state — Y.Doc bindings, plugin state, subscriptions) runs before the
    // engine layer it depends on is released. Matches the docs in
    // `ExtensionConfig.onEditorReady` / `onViewReady` ("invoked in reverse").
    for (let i = this.runtimeCleanup.length - 1; i >= 0; i--) {
      this.runtimeCleanup[i]!();
    }
    this.runtimeCleanup = [];
    this.eventHandlers.clear();
    this.listeners.clear();
  }

  // ── Protected helpers ────────────────────────────────────────────────────────

  /**
   * Apply a transaction to state, emit "update", and notify subscribers.
   * Called by `applyTransaction` (base) and `dispatch` (in Editor).
   */
  protected applyState(tr: Transaction): void {
    this.editorState = this.editorState.apply(tr);
    this.emit("update", { docChanged: tr.docChanged });
    this.notifyListeners();
  }

  protected notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  /**
   * Invoke all `onEditorReady` callbacks from extensions and accumulate
   * their cleanup fns into `runtimeCleanup`. Engine-only — fires in both
   * `Editor` and `ServerEditor`. Subclasses call this from their
   * constructor after the engine is initialised. The browser `Editor`
   * additionally fires `onViewReady` after view infrastructure exists;
   * both cleanups land in the same array.
   */
  protected fireEditorReady(): void {
    const callbacks = this.manager.buildEditorReadyCallbacks();
    for (const cb of callbacks) {
      const cleanup = cb(this);
      if (typeof cleanup === "function") this.runtimeCleanup.push(cleanup);
    }
  }

  /**
   * The dispatch function used by the command builder.
   * `BaseEditor` routes through `applyTransaction` (no view side-effects).
   * `Editor` overrides this to route through `dispatch()` (full view updates).
   */
  protected dispatchToActive(tr: Transaction): void {
    this.applyTransaction(tr);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** State for the active editing target — body or surface. Editor overrides to route. */
  protected getActiveState(): EditorState {
    return this.editorState;
  }

  private buildCommands(): SafeFlatCommands {
    const rawCommands = this.manager.buildCommands();
    const bound: Record<string, (...args: unknown[]) => void> = {};
    for (const [name, factory] of Object.entries(rawCommands)) {
      bound[name] = (...args: unknown[]) => {
        if (this.readOnlyValue) return;
        const cmd = factory(...args);
        cmd(this.getActiveState(), (tr) => this.dispatchToActive(tr));
      };
    }
    return bound as SafeFlatCommands;
  }
}
