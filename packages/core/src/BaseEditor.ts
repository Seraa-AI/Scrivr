import { EditorState, Transaction } from "prosemirror-state";
import { MarkdownSerializer } from "prosemirror-markdown";
import type { Schema } from "prosemirror-model";

import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import type { Extension } from "./extensions/Extension";
import type { IBaseEditor } from "./extensions/types";
import type { SafeFlatCommands, EditorEvents, ExtensionStorage } from "./types/augmentation";

export interface BaseEditorOptions {
  /**
   * Extensions that define the schema, plugins, and commands.
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
  protected readonly _manager: ExtensionManager;
  /**
   * The flow document's state.
   *
   * Flow-is-identity invariant (load-bearing): this field MUST always
   * reference the flow document. Never reassign it to an active
   * EditorSurface's state. Input routing is re-targeted at the Editor level
   * via wrapped `getState` callbacks; document identity lives here and must
   * not move. Save hooks, commands, subscribers, and collaborative adapters
   * all read through this — if it ever points at a surface they silently
   * target the wrong document.
   */
  protected _state: EditorState;

  private _readOnly = false;
  private readonly _listeners = new Set<() => void>();

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

  private readonly _eventHandlers = new Map<
    keyof EditorEvents,
    Set<(payload: EditorEvents[keyof EditorEvents]) => void>
  >();

  protected _editorReadyCleanup: Array<() => void> = [];

  constructor({ extensions = [StarterKit], content }: BaseEditorOptions = {}) {
    this._manager = new ExtensionManager(extensions);

    const initialDoc = content
      ? this._manager.schema.nodeFromJSON(content)
      : this._manager.buildInitialDoc();

    this._state = EditorState.create({
      schema: this._manager.schema,
      plugins: this._manager.buildPlugins(),
      ...(initialDoc ? { doc: initialDoc } : {}),
    });

    this.commands = this._buildCommands();
  }

  /** The merged ProseMirror Schema built from all extensions. */
  get schema(): Schema {
    return this._manager.schema;
  }

  getState(): EditorState {
    return this._state;
  }

  /** True when the editor is in read-only / view mode. */
  get readOnly(): boolean {
    return this._readOnly;
  }

  /**
   * Enable or disable read-only mode. When true, all document mutations are
   * blocked and the cursor is hidden. Notifies subscribers so UI can react.
   *
   * Subclasses (Editor) override this to also gate InputBridge + CursorManager.
   */
  setReadOnly(value: boolean): void {
    if (this._readOnly === value) return;
    this._readOnly = value;
    this._notifyListeners();
  }

  /** Merge attrs into the node at docPos. No-op if no node exists there. */
  setNodeAttrs(docPos: number, attrs: Record<string, unknown>): void {
    const node = this._state.doc.nodeAt(docPos);
    if (!node) return;
    this._applyTransaction(
      this._state.tr.setNodeMarkup(docPos, undefined, { ...node.attrs, ...attrs }),
    );
  }

  _applyTransaction(tr: Transaction): void {
    this._applyState(tr);
  }

  getMarkdown(): string {
    return this.getMarkdownSerializer().serialize(this._state.doc);
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
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
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    const handlers = this._eventHandlers.get(event)!;
    handlers.add(handler as (p: EditorEvents[keyof EditorEvents]) => void);
    return () => this.off(event, handler);
  }

  /** Unregister a typed event handler. */
  off<K extends keyof EditorEvents>(
    event: K,
    handler: (payload: EditorEvents[K]) => void,
  ): void {
    this._eventHandlers
      .get(event)
      ?.delete(handler as (p: EditorEvents[keyof EditorEvents]) => void);
  }

  /** Emit a typed editor event. Called internally — extensions may also call this. */
  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    this._eventHandlers.get(event)?.forEach((h) => h(payload));
  }

  getMarkdownSerializer(): MarkdownSerializer {
    const { nodes, marks } = this._manager.buildMarkdownSerializerRules();
    return new MarkdownSerializer(nodes, marks);
  }

  /** Plain text content of the document. */
  getText(): string {
    return this._state.doc.textContent;
  }

  /** Serialize the document to ProseMirror JSON. */
  toJSON(): Record<string, unknown> {
    return this._state.doc.toJSON() as Record<string, unknown>;
  }

  /**
   * Returns the names of marks active at the current cursor/selection.
   *
   * - Collapsed cursor: uses stored marks or the marks of the text node before the cursor.
   * - Range selection: a mark is active only if it spans every text node in the range.
   */
  getActiveMarks(): string[] {
    const { selection, storedMarks } = this._state;
    const { from, to, empty } = selection;

    if (empty) {
      const marks = storedMarks ?? selection.$from.marks();
      return marks.map((m) => m.type.name);
    }

    return Object.keys(this.schema.marks).filter((name) => {
      const markType = this.schema.marks[name]!;
      let hasText = false;
      let allHaveMark = true;
      this._state.doc.nodesBetween(from, to, (node) => {
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
    const { selection, storedMarks } = this._state;
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
        this._state.doc.nodesBetween(from, to, (node) => {
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
    const { $from } = this._state.selection;
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
    for (const cleanup of this._editorReadyCleanup) cleanup();
    this._editorReadyCleanup = [];
    this._eventHandlers.clear();
    this._listeners.clear();
  }

  // ── Protected helpers ────────────────────────────────────────────────────────

  /**
   * Apply a transaction to state, emit "update", and notify subscribers.
   * Called by `_applyTransaction` (base) and `dispatch` (in Editor).
   */
  protected _applyState(tr: Transaction): void {
    this._state = this._state.apply(tr);
    this.emit("update", { docChanged: tr.docChanged });
    this._notifyListeners();
  }

  protected _notifyListeners(): void {
    this._listeners.forEach((l) => l());
  }

  /**
   * Invoke all `onEditorReady` callbacks from extensions.
   * Subclasses call this at the END of their own constructor, after all
   * infrastructure (including view infrastructure) is initialised.
   */
  protected _fireEditorReady(): void {
    const callbacks = this._manager.buildEditorReadyCallbacks();
    this._editorReadyCleanup = callbacks
      .map((cb) => cb(this))
      .filter((fn): fn is () => void => typeof fn === "function");
  }

  /**
   * The dispatch function used by the command builder.
   * `BaseEditor` routes through `_applyTransaction` (no view side-effects).
   * `Editor` overrides this to route through `dispatch()` (full view updates).
   */
  protected _dispatchForCommands(tr: Transaction): void {
    this._applyTransaction(tr);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _buildCommands(): SafeFlatCommands {
    const rawCommands = this._manager.buildCommands();
    const bound: Record<string, (...args: unknown[]) => void> = {};
    for (const [name, factory] of Object.entries(rawCommands)) {
      bound[name] = (...args: unknown[]) => {
        const cmd = factory(...args);
        cmd(this._state, (tr) => this._dispatchForCommands(tr));
      };
    }
    return bound as SafeFlatCommands;
  }
}
