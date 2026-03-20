import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { InputHandler, FontModifier, MarkDecorator, ToolbarItemSpec } from "./extensions/types";
import type { Schema } from "prosemirror-model";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import { BlockRegistry } from "./layout/BlockRegistry";
import type { Extension } from "./extensions/Extension";
import { CursorManager } from "./renderer/CursorManager";
import { CharacterMap } from "./layout/CharacterMap";
import { TextMeasurer } from "./layout/TextMeasurer";
import { layoutDocument, defaultPageConfig } from "./layout/PageLayout";
import type { PageConfig, DocumentLayout } from "./layout/PageLayout";
import { populateCharMap } from "./layout/BlockLayout";
import { insertText } from "./model/commands";
import { PasteTransformer } from "./input/PasteTransformer";

/**
 * Convert a DOM KeyboardEvent into a ProseMirror key string.
 *
 * Format: [Mod-][Alt-][Shift-]key
 *   - "Mod" = Cmd on Mac, Ctrl on Windows/Linux
 *   - Single-character keys are lowercased (Shift is already in the prefix)
 *   - Special keys keep their DOM name: "Enter", "Backspace", "Delete", "Tab"
 *
 * Examples: Cmd+B → "Mod-b", Cmd+Shift+Z → "Mod-Shift-z", Enter → "Enter"
 */
function keyEventToString(e: KeyboardEvent): string {
  let key = e.key;
  let prefix = "";
  if (e.metaKey || e.ctrlKey) prefix += "Mod-";
  if (e.altKey)  prefix += "Alt-";
  if (e.shiftKey) prefix += "Shift-";

  // On macOS, Option (Alt) transforms e.key into special characters
  // (e.g. Option+1 → "¡", Option+b → "∫"). When that happens, fall back to
  // e.code so that Mod-Alt-1 and similar bindings resolve correctly.
  if (e.altKey && key.length === 1 && !/^[a-zA-Z0-9]$/.test(key)) {
    if (e.code.startsWith("Digit")) key = e.code.slice(5);      // "Digit1" → "1"
    else if (e.code.startsWith("Key")) key = e.code.slice(3);   // "KeyB"   → "B"
  }

  // Single-character keys: lowercase so "Mod-b" matches whether or not Shift
  // is also held (e.g. Cmd+Shift+Z gives e.key="Z" — we want "Mod-Shift-z").
  if (key.length === 1) key = key.toLowerCase();
  return prefix + key;
}

export type EditorChangeHandler = (state: EditorState) => void;

/**
 * Snapshot of the current selection — passed to the rendering layer so it
 * can draw both the cursor and selection highlights without importing
 * ProseMirror types.
 */
export interface SelectionSnapshot {
  /** The fixed end of the selection (doesn't move when you Shift+arrow) */
  anchor: number;
  /** The moving end — where the cursor is drawn */
  head: number;
  /** Math.min(anchor, head) — start of the highlighted range */
  from: number;
  /** Math.max(anchor, head) — end of the highlighted range */
  to: number;
  /** True when anchor === head (cursor only, no highlight) */
  empty: boolean;
  /**
   * Names of marks active at the cursor (or present anywhere in the selection).
   * Use this to show toolbar button active states without importing ProseMirror.
   */
  activeMarks: string[];
  /**
   * Attributes of each active mark, keyed by mark name.
   * e.g. { color: { color: "#dc2626" }, font_size: { size: 18 } }
   */
  activeMarkAttrs: Record<string, Record<string, unknown>>;
  /** The ProseMirror node type name of the block containing the cursor: "paragraph", "heading", etc. */
  blockType: string;
  /** Attributes of that block node — e.g. { level: 1, align: "left" } for a heading */
  blockAttrs: Record<string, unknown>;
}

export interface EditorOptions {
  /**
   * Extensions that define the schema, keymap, and commands.
   * Defaults to [StarterKit] — paragraph, heading, bold, italic, history.
   */
  extensions?: Extension[];
  /**
   * Page dimensions and margins. Defaults to A4 with 1-inch margins.
   * The editor owns layout — it needs page geometry to run layoutDocument.
   */
  pageConfig?: PageConfig;
  /**
   * Called on every state change. Optional when using the React adapter —
   * the Canvas component subscribes internally via editor.subscribe().
   */
  onChange?: EditorChangeHandler;
  /**
   * Called when the editor gains or loses focus.
   * Use this to show/hide the cursor overlay.
   * Framework-agnostic — works with React, Vue, plain HTML.
   */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Called on every cursor blink tick (every 530ms) and immediately after
   * any user interaction that moves the cursor.
   *
   * The adapter (e.g. React PageView) should redraw the overlay canvas when
   * this fires. Receives `isVisible` so the overlay knows whether to draw
   * or clear the cursor.
   */
  onCursorTick?: (isVisible: boolean) => void;
}

/**
 * Editor — the single class consumers instantiate.
 *
 * Owns:
 *   - The ExtensionManager (schema, plugins, commands)
 *   - The ProseMirror EditorState (document + selection)
 *   - The hidden <textarea> that captures all keyboard input
 *
 * Does NOT own:
 *   - The <canvas> element — the renderer does
 *   - Layout — the layout engine does
 *
 * Usage:
 *   const editor = new Editor({ extensions: [StarterKit], onChange })
 *   editor.mount(containerElement)
 *   editor.destroy()
 *
 *   // Execute commands
 *   editor.commands.toggleBold()
 *   editor.commands.undo()
 */
export class Editor {
  private readonly manager: ExtensionManager;
  private state: EditorState;
  private textarea: HTMLTextAreaElement | null = null;
  private container: HTMLElement | null = null;
  private readonly onChange: EditorChangeHandler | undefined;
  private readonly onFocusChange: ((focused: boolean) => void) | undefined;

  /** Subscriber set — notified on every state change, focus change, and cursor tick. */
  private readonly listeners = new Set<() => void>();
  private _isFocused = false;

  // ── Engine-owned layout infrastructure ───────────────────────────────────

  /** Page dimensions and margins — drives layoutDocument. */
  readonly pageConfig: PageConfig;

  /** The text measurer used by the layout engine. Created once; caches are reused. */
  readonly measurer: TextMeasurer;

  /**
   * The CharacterMap — glyph positions for hit-testing and cursor rendering.
   * Owned by the editor, populated during ensureLayout() for all pages.
   */
  readonly charMap: CharacterMap;

  /**
   * The current document layout — pages, blocks, dimensions.
   * Re-computed by ensureLayout() after every state change.
   */
  private _layout: DocumentLayout;

  /**
   * True when the state has changed but layout has not yet been recomputed.
   * ensureLayout() clears this flag.
   */
  private dirty = false;

  /**
   * Adapter-provided function that resolves a 1-based page number to the
   * corresponding DOM element. Used by syncInputBridge / scrollCursorIntoView.
   * Set via setPageElementLookup() — null until the rendering adapter provides it.
   */
  private pageElementLookup: ((page: number) => HTMLElement | null) | null = null;

  /** Owns the cursor blink timer. Public so adapters can read isVisible. */
  readonly cursorManager: CursorManager;

  /**
   * Font modifier map built from all extensions.
   * Computed once at construction, used by layoutDocument.
   */
  readonly fontModifiers: Map<string, FontModifier>;

  /**
   * Mark decorator map built from all extensions.
   * Pass to renderPage — computed once at construction.
   */
  readonly markDecorators: Map<string, MarkDecorator>;

  /**
   * Toolbar item specs from all extensions, in registration order.
   * Data-only — no React. Computed once at construction.
   */
  readonly toolbarItems: ToolbarItemSpec[];

  /**
   * Block registry built from all extensions.
   * Pass to renderPage — maps node type names to BlockStrategy instances.
   */
  readonly blockRegistry: BlockRegistry;

  /**
   * Bound command map — each entry calls the extension command with the
   * current state + this editor's dispatch. Built once; closures over `this`
   * so they always read the latest state at call time.
   */
  readonly commands: Record<string, (...args: unknown[]) => void>;

  /** Merged keymap from all extensions — consulted on every keydown. */
  private readonly keymap: Record<string, Command>;
  private pasteTransformer!: PasteTransformer;
  /** Merged input handlers from all extensions — consulted before the keymap. */
  private readonly inputHandlers: Record<string, InputHandler>;

  constructor({ extensions = [StarterKit], pageConfig, onChange, onFocusChange, onCursorTick }: EditorOptions) {
    this.manager = new ExtensionManager(extensions);
    this.onChange = onChange;
    this.onFocusChange = onFocusChange;
    this.pageConfig = pageConfig ?? defaultPageConfig;
    this.measurer = new TextMeasurer({ lineHeightMultiplier: 1.2 });
    this.charMap = new CharacterMap();
    this.fontModifiers = this.manager.buildFontModifiers();
    this.markDecorators = this.manager.buildMarkDecorators();
    this.toolbarItems = this.manager.buildToolbarItems();
    this.blockRegistry = this.manager.buildBlockRegistry();
    this.cursorManager = new CursorManager(() => {
      onCursorTick?.(this.cursorManager.isVisible);
      this.notifyListeners();
    });

    this.state = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
    });

    // Initial layout — run synchronously so editor.layout is available immediately
    this._layout = layoutDocument(this.state.doc, {
      pageConfig: this.pageConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      previousVersion: 0,
    });
    this.populateCharMapFromLayout();

    this.keymap = this.manager.buildKeymap();
    this.inputHandlers = this.manager.buildInputHandlers();
    this.commands = this.buildCommands();
    this.pasteTransformer = new PasteTransformer(this.manager.schema, this.manager.buildMarkdownRules());
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * The merged ProseMirror Schema built from all extensions.
   * Use this instead of importing schema directly — it reflects whatever
   * extensions were loaded.
   */
  get schema(): Schema {
    return this.manager.schema;
  }

  getState(): EditorState {
    return this.state;
  }

  /**
   * The current document layout. Calls ensureLayout() so the result
   * always reflects the latest EditorState.
   */
  get layout(): DocumentLayout {
    this.ensureLayout();
    return this._layout;
  }

  /**
   * Guarantees the layout reflects the current EditorState.
   * Cheap when layout is already current (dirty === false).
   *
   * Called automatically by `layout`, movement methods, and `getSelectionSnapshot`.
   * Framework adapters should not need to call this directly.
   */
  ensureLayout(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.charMap.clear();
    this._layout = layoutDocument(this.state.doc, {
      pageConfig: this.pageConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      previousVersion: this._layout.version,
    });
    this.populateCharMapFromLayout();
  }

  private populateCharMapFromLayout(): void {
    for (const page of this._layout.pages) {
      let lineOffset = 0;
      for (const block of page.blocks) {
        populateCharMap(block, this.charMap, page.pageNumber, lineOffset, this.measurer);
        lineOffset += block.lines.length;
      }
    }
  }

  /**
   * Returns a lightweight snapshot of the current selection state.
   * Includes everything a toolbar or floating menu needs — no CharacterMap
   * or layout internals required.
   *
   * Ensures layout is current before computing.
   */
  getSelectionSnapshot(): SelectionSnapshot {
    this.ensureLayout();
    const { selection } = this.state;
    const blockInfo = this.getBlockInfo();
    return {
      anchor: selection.anchor,
      head: selection.head,
      from: selection.from,
      to: selection.to,
      empty: selection.empty,
      activeMarks: this.getActiveMarks(),
      activeMarkAttrs: this.getActiveMarkAttrs(),
      blockType: blockInfo.blockType,
      blockAttrs: blockInfo.blockAttrs,
    };
  }

  /**
   * Mount the editor onto a container element.
   * Creates the hidden textarea and attaches event listeners.
   */
  mount(container: HTMLElement): void {
    this.container = container;
    this.textarea = this.createHiddenTextarea();
    this.container.appendChild(this.textarea);
    this.attachListeners();
    this.textarea.focus();
  }

  /**
   * Tear down the mounted view (textarea + event listeners) without
   * destroying the Editor itself. Safe to call multiple times.
   * After unmount the editor can be re-mounted with mount().
   */
  unmount(): void {
    if (this.textarea) {
      this.detachListeners();
      this.textarea.remove();
      this.textarea = null;
    }
    this.container = null;
    this.pageElementLookup = null;
  }

  destroy(): void {
    this.cursorManager.stop();
    this.unmount();
  }

  focus(): void {
    this.textarea?.focus();
  }

  /**
   * Register a function that resolves a 1-based page number to the
   * DOM element representing that page. Called by the rendering adapter
   * (e.g. Canvas) after mount so the editor can position the textarea
   * and scroll the cursor into view.
   */
  setPageElementLookup(fn: ((page: number) => HTMLElement | null) | null): void {
    this.pageElementLookup = fn;
  }

  /**
   * Positions the hidden textarea at the cursor's visual location.
   *
   * Without this, the textarea sits at top:0 and the browser scrolls the
   * scroll container back to the top whenever the user types — because
   * the browser wants to keep the focused element visible.
   *
   * Also critical for mobile IME: the suggestion bar and magnifier appear
   * near the textarea, so placing it at the cursor makes them usable.
   */
  syncInputBridge(): void {
    if (!this.textarea || !this.container || !this.pageElementLookup) return;

    const { head } = this.state.selection;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;

    const pageEl = this.pageElementLookup(coords.page);
    if (!pageEl) return;

    const containerRect = this.container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    Object.assign(this.textarea.style, {
      top: `${(pageRect.top - containerRect.top) + coords.y}px`,
      left: `${(pageRect.left - containerRect.left) + coords.x}px`,
      height: `${coords.height}px`,
    });
  }

  /**
   * Scrolls the nearest scrollable ancestor so the cursor is visible.
   *
   * Called after every state change (from dispatch) and after React renders
   * (from the adapter) as a safety net for new-page scenarios.
   */
  scrollCursorIntoView(): void {
    if (!this.container || !this.pageElementLookup) return;

    const { head } = this.state.selection;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;

    const pageEl = this.pageElementLookup(coords.page);
    if (!pageEl) return;

    const scrollParent = findScrollParent(this.container);
    if (!scrollParent) return;

    const pageRect = pageEl.getBoundingClientRect();
    const scrollRect = scrollParent.getBoundingClientRect();

    const cursorTop = pageRect.top + coords.y;
    const cursorBottom = cursorTop + coords.height;
    const buffer = 40;

    if (cursorBottom > scrollRect.bottom - buffer) {
      scrollParent.scrollTop += cursorBottom - scrollRect.bottom + buffer;
    } else if (cursorTop < scrollRect.top + buffer) {
      scrollParent.scrollTop -= scrollRect.top - cursorTop + buffer;
    }
  }

  /**
   * Collapse the cursor to a specific doc position.
   * Safe to call with any integer — clamps and resolves to nearest valid text pos.
   */
  moveCursorTo(docPos: number): void {
    this.applyMovement(docPos, false);
    this.focus();
  }

  /**
   * Set an explicit anchor + head, creating a non-collapsed selection.
   * Used for Shift+click and click+drag.
   */
  setSelection(anchor: number, head: number): void {
    const size = this.state.doc.content.size;
    const a = Math.max(0, Math.min(anchor, size));
    const h = Math.max(0, Math.min(head, size));
    const $a = this.state.doc.resolve(a);
    const $h = this.state.doc.resolve(h);
    this.dispatch(
      this.state.tr.setSelection(TextSelection.between($a, $h))
    );
    this.focus();
  }

  /** Move left one position. Pass extend=true to grow the selection (Shift+←). */
  moveLeft(extend = false): void {
    const head = this.state.selection.head;
    if (head <= 0) return;
    const $pos = this.state.doc.resolve(Math.max(0, head - 1));
    this.applyMovement(TextSelection.near($pos, -1).head, extend);
  }

  /** Move right one position. Pass extend=true to grow the selection (Shift+→). */
  moveRight(extend = false): void {
    const head = this.state.selection.head;
    const size = this.state.doc.content.size;
    if (head >= size) return;
    const $pos = this.state.doc.resolve(Math.min(size, head + 1));
    this.applyMovement(TextSelection.near($pos, 1).head, extend);
  }

  /** Move up one line preserving x. Pass extend=true for Shift+↑. */
  moveUp(extend = false): void {
    this.ensureLayout();
    const head = this.state.selection.head;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.charMap.posAbove(head, coords.x);
    if (pos !== null) this.applyMovement(pos, extend);
  }

  /**
   * Returns the names of marks active at the current cursor/selection.
   *
   * - Collapsed cursor: uses stored marks (pending marks set by toggleMark) or
   *   the marks of the text node immediately before the cursor.
   * - Range selection: a mark is considered active only if it spans every text
   *   node in the range (matches toggleMark's "all-or-nothing" toggle logic).
   */
  getActiveMarks(): string[] {
    const { selection, storedMarks } = this.state;
    const { from, to, empty } = selection;

    if (empty) {
      const marks = storedMarks ?? selection.$from.marks();
      return marks.map((m) => m.type.name);
    }

    // Range: active = present on every text node in [from, to)
    return Object.keys(this.schema.marks).filter((name) => {
      const markType = this.schema.marks[name]!;
      let hasText = false;
      let allHaveMark = true;
      this.state.doc.nodesBetween(from, to, (node) => {
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
   * Keys are mark names; values are the mark's attrs object.
   * For a range selection, only marks active across the entire range are included.
   */
  getActiveMarkAttrs(): Record<string, Record<string, unknown>> {
    const { selection, storedMarks } = this.state;
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
        // Collect attrs from the first text node that has this mark
        this.state.doc.nodesBetween(from, to, (node) => {
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
    const { $from } = this.state.selection;
    // Walk up to the direct child of doc (depth 1) so container nodes like
    // bulletList / orderedList are returned rather than their inner paragraph.
    // This lets toolbar isActive correctly detect "we are inside a bullet list".
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

  /** Whether the editor's textarea currently has focus. */
  get isFocused(): boolean {
    return this._isFocused;
  }

  /**
   * Subscribe to all editor notifications: state changes, focus, cursor ticks.
   * Returns an unsubscribe function. Used by useSyncExternalStore in React adapters.
   *
   * @example
   * const unsubscribe = editor.subscribe(() => forceUpdate());
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Returns the current ProseMirror EditorState.
   * ProseMirror states are immutable — reference equality detects changes.
   * Used as the getSnapshot function for useSyncExternalStore.
   */
  getSnapshot(): EditorState {
    return this.state;
  }

  /**
   * Returns true when the named mark or block type is active at the cursor.
   * Mirrors TipTap's editor.isActive() — same call signature.
   *
   * @example
   * editor.isActive('bold')               // mark active?
   * editor.isActive('heading', { level: 1 }) // h1 active?
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

  /** Move down one line preserving x. Pass extend=true for Shift+↓. */
  moveDown(extend = false): void {
    this.ensureLayout();
    const head = this.state.selection.head;
    const coords = this.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.charMap.posBelow(head, coords.x);
    if (pos !== null) this.applyMovement(pos, extend);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Core movement primitive.
   *
   * extend=false → collapsed cursor at newHead
   * extend=true  → selection from current anchor to newHead (Shift+arrow / drag)
   */
  private applyMovement(newHead: number, extend: boolean): void {
    const size = this.state.doc.content.size;
    const h = Math.max(0, Math.min(newHead, size));
    const a = extend ? this.state.selection.anchor : h;
    // TextSelection.between resolves positions safely — handles node boundaries
    // and position 0 without throwing, unlike TextSelection.create.
    const $a = this.state.doc.resolve(Math.max(0, Math.min(a, size)));
    const $h = this.state.doc.resolve(h);
    this.dispatch(
      this.state.tr.setSelection(TextSelection.between($a, $h))
    );
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  private dispatch(tr: Transaction | null): void {
    if (!tr) return;
    this.state = this.state.apply(tr);
    this.dirty = true;
    this.ensureLayout();
    this.cursorManager.reset();
    // ViewManager.update() runs inside notifyListeners (via subscribe),
    // creating any new page DOM elements before we position the textarea.
    this.notifyListeners();
    this.syncInputBridge();
    this.scrollCursorIntoView();
    this.onChange?.(this.state);
  }

  /**
   * Build bound command wrappers.
   * Each wrapper reads `this.state` at call time (not construction time)
   * because the closure captures `this` by reference.
   */
  private buildCommands(): Record<string, (...args: unknown[]) => void> {
    const rawCommands = this.manager.buildCommands();
    const bound: Record<string, (...args: unknown[]) => void> = {};

    for (const [name, factory] of Object.entries(rawCommands)) {
      bound[name] = (...args: unknown[]) => {
        const cmd = factory(...args);
        cmd(this.state, (tr) => this.dispatch(tr));
      };
    }

    return bound;
  }

  private createHiddenTextarea(): HTMLTextAreaElement {
    const ta = document.createElement("textarea");

    Object.assign(ta.style, {
      position: "absolute",
      opacity: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "none",
      margin: "0",
      overflow: "hidden",
      resize: "none",
      outline: "none",
      pointerEvents: "none",
      top: "0",
      left: "0",
    });

    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    // aria-hidden on a focused element is invalid — the textarea IS the
    // keyboard/IME input bridge, so screen readers should be able to reach it.
    ta.setAttribute("role", "textbox");
    ta.setAttribute("aria-multiline", "true");
    ta.setAttribute("aria-label", "Document editor");
    ta.setAttribute("tabindex", "0");

    return ta;
  }

  private attachListeners(): void {
    const ta = this.textarea!;
    ta.addEventListener("keydown", this.handleKeydown);
    ta.addEventListener("input", this.handleInput);
    ta.addEventListener("compositionend", this.handleCompositionEnd);
    ta.addEventListener("paste", this.handlePaste);
    ta.addEventListener("focus", this.handleFocus);
    ta.addEventListener("blur", this.handleBlur);
  }

  private detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this.handleKeydown);
    ta.removeEventListener("input", this.handleInput);
    ta.removeEventListener("compositionend", this.handleCompositionEnd);
    ta.removeEventListener("paste", this.handlePaste);
    ta.removeEventListener("focus", this.handleFocus);
    ta.removeEventListener("blur", this.handleBlur);
  }

  private handleFocus = (): void => {
    this._isFocused = true;
    this.cursorManager.start();
    this.notifyListeners();
    this.onFocusChange?.(true);
  };

  private handleBlur = (): void => {
    this._isFocused = false;
    this.cursorManager.stop();
    this.notifyListeners();
    this.onFocusChange?.(false);
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    // Input handlers first — editor-level actions (navigation, etc.)
    // declared by extensions via addInputHandlers().
    if (this.tryInputHandler(e)) {
      e.preventDefault();
      return;
    }
    // Tab must always be captured so the browser never shifts focus away.
    if (e.key === "Tab") e.preventDefault();
    // Then document-level commands declared by extensions via addKeymap().
    if (this.tryKeymapCommand(e)) {
      e.preventDefault();
      this.clearTextarea();
    }
  };

  private handleInput = (e: Event): void => {
    if ((e as InputEvent).isComposing) return;
    const text = this.textarea!.value;
    if (!text) return;
    this.dispatch(insertText(this.state, text));
    this.clearTextarea();
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    const text = e.data;
    if (!text) return;
    this.dispatch(insertText(this.state, text));
    this.clearTextarea();
  };

  /**
   * Look up the key event in the extension input handlers and run it if found.
   * Returns true when a handler was executed.
   */
  private tryInputHandler(e: KeyboardEvent): boolean {
    const handler = this.inputHandlers[e.key];
    if (!handler) return false;
    return handler(this, e);
  }

  /**
   * Look up the key event in the extension keymap and run the command if found.
   * Returns true when a command was executed (so the caller can preventDefault).
   */
  private tryKeymapCommand(e: KeyboardEvent): boolean {
    const key = keyEventToString(e);
    const cmd = this.keymap[key];
    if (!cmd) return false;
    return cmd(this.state, (tr) => this.dispatch(tr));
  }

  private handlePaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    if (!e.clipboardData) return;
    const tr = this.pasteTransformer.transform(e.clipboardData, this.state);
    if (tr) this.dispatch(tr);
  };

  private clearTextarea(): void {
    if (this.textarea) this.textarea.value = "";
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}
