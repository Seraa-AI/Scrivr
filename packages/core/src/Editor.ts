import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { InputHandler, FontModifier, MarkDecorator, ToolbarItemSpec, OverlayRenderHandler, IEditor } from "./extensions/types";
import type { Schema } from "prosemirror-model";
import { Node } from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";
import { ExtensionManager } from "./extensions/ExtensionManager";
import { StarterKit } from "./extensions/StarterKit";
import { BlockRegistry } from "./layout/BlockRegistry";
import type { Extension } from "./extensions/Extension";
import { CursorManager } from "./renderer/CursorManager";
import { CharacterMap } from "./layout/CharacterMap";
import { TextMeasurer } from "./layout/TextMeasurer";
import { layoutDocument, defaultPageConfig } from "./layout/PageLayout";
import type { PageConfig, DocumentLayout, MeasureCacheEntry, LayoutResumption } from "./layout/PageLayout";
import type { FontConfig } from "./layout/FontConfig";
import { populateCharMap } from "./layout/BlockLayout";
import { insertText, deleteSelection } from "./model/commands";
import { PasteTransformer } from "./input/PasteTransformer";
import { serializeSelectionToHtml } from "./input/ClipboardSerializer";

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

  // Normalize space to "Space" — ProseMirror convention; extensions bind "Space", not " ".
  if (key === " ") key = "Space";

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
  /**
   * When false, all rAF render flushes are suppressed until setReady(true)
   * is called. Use this for collaborative documents where a Y.js / HocusPocus
   * provider will fire hundreds of typeObserver events during initial sync —
   * suppressing flushes means zero layout work during sync, then a single
   * full layout + paint once the provider fires its `synced` event.
   *
   * Example:
   *   const editor = new Editor({ startReady: false, ... });
   *   provider.on('synced', () => editor.setReady(true));
   *
   * Defaults to true (standard, non-collaborative use).
   */
  startReady?: boolean;
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
   * True when the current _layout is a partial result (streaming initial load).
   * An idle callback will complete it; cleared immediately when the user
   * triggers ensureLayout() (which always runs a full layout pass).
   */
  private _layoutIsPartial = false;

  /** Handle returned by requestIdleCallback for the pending layout completion. */
  private _idleLayoutId: number | null = null;

  /**
   * Tracks how many blocks have been laid out in the current chunked pass.
   * Incremented by LAYOUT_CHUNK_SIZE on each idle tick. Reset at the start of
   * each new chunked pass (constructor, setReady).
   */
  private _partialLayoutBlocks = 0;

  /**
   * Resumption state from the last partial layoutDocument() call.
   * Passed back on the next chunk so layout continues in O(N) rather than
   * restarting from block 0 each time (which would be O(N²) total).
   * Null when no chunked pass is in progress.
   */
  private _layoutResumption: LayoutResumption | null = null;

  /**
   * requestAnimationFrame handle for the pending render flush.
   * Multiple dispatch() calls within the same frame share a single flush,
   * collapsing e.g. hundreds of Y.js sync operations into one layout + one paint.
   */
  private _rafId: number | null = null;

  /**
   * When false, scheduleFlush() is a no-op — all dispatches accumulate as dirty
   * state without triggering any layout or paint. Set to false via startReady:false
   * when a collaborative provider is syncing; call setReady(true) from the
   * provider's `synced` event to flush once with the complete document.
   */
  private _ready = true;

  /**
   * The 1-based page number that contains the current cursor.
   * Computed once in ensureLayout() from the layout (no charmap needed) and
   * cached here so ViewManager can read it cheaply on every overlay paint
   * without re-walking the layout blocks.
   */
  private _cursorPage = 1;

  /**
   * Set of page numbers whose CharacterMap entries have been populated.
   * Cleared on every ensureLayout() call (charMap is cleared too).
   * Makes ensurePagePopulated idempotent — ViewManager calls it before every
   * paint, but each page is only populated once per layout cycle.
   */
  private readonly populatedPages = new Set<number>();

  /**
   * Block measurement cache — maps ProseMirror Node references to their last
   * measured dimensions (height, lines, spacing). Persists across layout runs.
   *
   * ProseMirror's structural sharing ensures unchanged nodes keep the same JS
   * object identity, so a WeakMap keyed on Node is a zero-cost invalidation
   * scheme: edits automatically produce new Node objects for changed blocks,
   * while unchanged blocks get instant cache hits and skip layoutBlock entirely.
   *
   * WeakMap prevents memory leaks — entries are GC'd when their Node is gone.
   */
  private readonly measureCache = new WeakMap<Node, MeasureCacheEntry>();

  /**
   * Adapter-provided function that resolves a 1-based page number to the
   * corresponding DOM element. Used by syncInputBridge / scrollCursorIntoView.
   * Set via setPageElementLookup() — null until the rendering adapter provides it.
   */
  private pageElementLookup: ((page: number) => HTMLElement | null) | null = null;

  /** Owns the cursor blink timer. Public so adapters can read isVisible. */
  readonly cursorManager: CursorManager;

  /**
   * Merged block styles from all extensions — the fontConfig passed to every
   * layoutDocument call. Built once at construction from ExtensionManager.
   */
  readonly fontConfig: FontConfig;

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

  /**
   * Overlay render handlers registered by extensions (e.g. CollaborationCursor).
   * Called by ViewManager.paintOverlay() for each visible page.
   */
  private readonly overlayRenderHandlers = new Set<OverlayRenderHandler>();

  /** Cleanup functions returned by onEditorReady() callbacks — called on destroy(). */
  private editorReadyCleanup: Array<() => void> = [];

  constructor({ extensions = [StarterKit], pageConfig, onChange, onFocusChange, onCursorTick, startReady = true }: EditorOptions) {
    this.manager = new ExtensionManager(extensions);
    this.onChange = onChange;
    this.onFocusChange = onFocusChange;
    this.pageConfig = this.manager.buildPageConfig() ?? pageConfig ?? defaultPageConfig;
    this.fontConfig = this.manager.buildBlockStyles();
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

    const initialDoc = this.manager.buildInitialDoc();
    this.state = EditorState.create({
      schema: this.manager.schema,
      plugins: this.manager.buildPlugins(),
      ...(initialDoc ? { doc: initialDoc } : {}),
    });

    // Initial layout — measure only the first INITIAL_BLOCKS blocks synchronously
    // so the browser can paint the visible pages in the first frame. The rest
    // are completed in an idle callback once the browser is idle.
    performance.mark("inscribe:layout-initial-start");
    this._layout = layoutDocument(this.state.doc, {
      pageConfig: this.pageConfig,
      fontConfig: this.fontConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      previousVersion: 0,
      measureCache: this.measureCache,
      maxBlocks: Editor.INITIAL_BLOCKS,
    });
    performance.mark("inscribe:layout-initial-end");
    performance.measure(
      `inscribe:layout-initial (${this.state.doc.childCount} blocks, first ${Editor.INITIAL_BLOCKS} sync)`,
      "inscribe:layout-initial-start",
      "inscribe:layout-initial-end",
    );
    this._layoutIsPartial = this._layout.isPartial ?? false;
    this._layoutResumption = this._layout.resumption ?? null;
    // Populate page 1 eagerly — the document always starts on page 1.
    this.ensurePagePopulated(1);
    if (this._layoutIsPartial) {
      this._partialLayoutBlocks = Editor.INITIAL_BLOCKS;
      this.scheduleIdleLayout();
    }

    // If startReady:false, cancel the idle layout and suppress all flushes
    // until setReady(true) is called (e.g. from provider.on('synced', ...)).
    // The idle layout would run on a partial Y.js doc and get immediately
    // invalidated; better to do one full layout after sync completes.
    if (!startReady) {
      this._ready = false;
      if (this._idleLayoutId !== null) {
        if (typeof cancelIdleCallback !== "undefined") {
          cancelIdleCallback(this._idleLayoutId);
        } else {
          clearTimeout(this._idleLayoutId as unknown as number);
        }
        this._idleLayoutId = null;
      }
      this._layoutIsPartial = false;
    }

    this.keymap = this.manager.buildKeymap();
    this.inputHandlers = this.manager.buildInputHandlers();
    this.commands = this.buildCommands();
    this.pasteTransformer = new PasteTransformer(
      this.manager.schema,
      this.manager.buildMarkdownRules(),
      this.manager.buildMarkdownParserTokens(),
    );

    // Invoke onEditorReady() for all extensions that define it.
    // Runs after everything is initialised so extensions can safely subscribe,
    // read state, register overlay handlers, etc.
    const readyCallbacks = this.manager.buildEditorReadyCallbacks();
    this.editorReadyCleanup = readyCallbacks
      .map((cb) => cb(this))
      .filter((fn): fn is () => void => typeof fn === "function");
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Signal that the editor is (or is no longer) ready to render.
   *
   * Pass `false` before a collaborative provider connects to suppress all rAF
   * render flushes during the initial Y.js document sync — prevents O(N²)
   * layout work while typeObserver fires hundreds of times.
   *
   * Pass `true` once the provider fires its `synced` event. The editor will
   * do a single full layout + paint of the complete document.
   *
   * Example (HocusPocus):
   *   const editor = new Editor({ startReady: false, ... });
   *   provider.on('synced', () => editor.setReady(true));
   */
  setReady(ready: boolean): void {
    this._ready = ready;
    if (ready) {
      // Cancel any stale pending work — we're about to do a fresh chunked layout.
      if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      if (this._idleLayoutId !== null) {
        if (typeof cancelIdleCallback !== "undefined") cancelIdleCallback(this._idleLayoutId);
        else clearTimeout(this._idleLayoutId as unknown as number);
        this._idleLayoutId = null;
      }

      // First chunk: layout INITIAL_BLOCKS synchronously so visible pages
      // paint immediately — same strategy as the constructor.
      this._partialLayoutBlocks = Editor.INITIAL_BLOCKS;
      this.dirty = false;
      this.charMap.clear();
      this.populatedPages.clear();
      this._layout = layoutDocument(this.state.doc, {
        pageConfig: this.pageConfig,
        fontConfig: this.fontConfig,
        measurer: this.measurer,
        fontModifiers: this.fontModifiers,
        previousVersion: this._layout.version,
        measureCache: this.measureCache,
        maxBlocks: Editor.INITIAL_BLOCKS,
      });
      this._layoutIsPartial = this._layout.isPartial ?? false;
      this._layoutResumption = this._layout.resumption ?? null;
      this._cursorPage = this.cursorPageFromLayout();
      this.ensurePagePopulated(this._cursorPage);
      this.ensurePagePopulated(this._cursorPage - 1);
      this.ensurePagePopulated(this._cursorPage + 1);
      this.notifyListeners(); // paint first pages right away

      if (this._layoutIsPartial) {
        this.scheduleIdleLayout(); // continue measuring remaining blocks in idle chunks
      }
    } else {
      // Going unready — cancel any pending flush to prevent a stale render.
      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }
  }

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
   * Convert a doc position range to a viewport DOMRect.
   *
   * Uses the CharacterMap for pixel-accurate canvas coordinates, then offsets
   * by the page element's viewport position (registered by the rendering adapter
   * via setPageElementLookup). Returns null if either position is not in the
   * CharacterMap or if no adapter has registered a page element lookup.
   *
   * The returned rect spans from the `from` position to the `to` position.
   * If both positions are on different lines, the rect uses the `from` line's
   * y/height and extends to the right edge of the available content width.
   */
  getViewportRect(from: number, to: number): DOMRect | null {
    if (!this.pageElementLookup) return null;
    this.ensureLayout();

    const fromCoords = this.charMap.coordsAtPos(from);
    if (!fromCoords) return null;

    const pageEl = this.pageElementLookup(fromCoords.page);
    if (!pageEl) return null;

    const pageRect = pageEl.getBoundingClientRect();
    const toCoords = this.charMap.coordsAtPos(to);

    const left   = pageRect.left + fromCoords.x;
    const top    = pageRect.top  + fromCoords.y;
    const height = fromCoords.height;

    // Width: span to toCoords if on same line, otherwise use a minimal 1px width
    const sameLine = toCoords && toCoords.page === fromCoords.page &&
      Math.abs(toCoords.y - fromCoords.y) < 2;
    const width = sameLine && toCoords ? Math.abs(toCoords.x - fromCoords.x) : 1;

    return new DOMRect(left, top, Math.max(1, width), height);
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
    // A user action triggered a full layout — the idle pass is no longer needed.
    this._layoutIsPartial = false;
    this._layoutResumption = null;
    this.charMap.clear();
    this.populatedPages.clear();
    const previousLayout = this._layout;
    this._layout = layoutDocument(this.state.doc, {
      pageConfig: this.pageConfig,
      fontConfig: this.fontConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      previousVersion: previousLayout.version,
      measureCache: this.measureCache,
      previousLayout,
    });
    // Populate only the cursor page ± 1.
    // The cursor page is required for coordsAtPos (cursor draw + selection).
    // Adjacent pages (± 1) are required for posAbove / posBelow at page
    // boundaries (keyboard ↑/↓ crossing a page break).
    // All other visible pages are populated on demand by ViewManager before
    // each paint, so their charmap entries are always ready when needed.
    this._cursorPage = this.cursorPageFromLayout();
    this.ensurePagePopulated(this._cursorPage);
    this.ensurePagePopulated(this._cursorPage - 1); // no-op when page < 1 or doesn't exist
    this.ensurePagePopulated(this._cursorPage + 1); // no-op when page doesn't exist
  }

  // ── Streaming layout helpers ───────────────────────────────────────────────

  /** Number of blocks measured synchronously on initial load (~2–3 visible pages). */
  private static readonly INITIAL_BLOCKS = 100;

  /**
   * Blocks to process per idle chunk. Small enough to stay within a ~16ms
   * idle slice; large enough to finish a 1000-block doc in ~20 ticks.
   */
  private static readonly LAYOUT_CHUNK_SIZE = 50;

  /**
   * Schedule the next idle-callback chunk that continues a partial layout.
   * Uses requestIdleCallback when available; falls back to setTimeout(fn, 16).
   */
  private scheduleIdleLayout(): void {
    const run = (deadline?: IdleDeadline) => this.completeIdleLayout(deadline);
    if (typeof requestIdleCallback !== "undefined") {
      this._idleLayoutId = requestIdleCallback(run);
    } else {
      this._idleLayoutId = setTimeout(() => run(), 16) as unknown as number;
    }
  }

  /**
   * Processes one chunk of the remaining layout in the idle callback.
   * Advances _partialLayoutBlocks by LAYOUT_CHUNK_SIZE (or more if the idle
   * deadline allows), notifies listeners, then re-schedules until done.
   *
   * If the user types between chunks, ensureLayout() sets _layoutIsPartial=false
   * and this becomes a no-op.
   */
  private completeIdleLayout(deadline?: IdleDeadline): void {
    this._idleLayoutId = null;
    if (!this._layoutIsPartial) return;

    // Determine how many NEW blocks to measure this chunk.
    // Use the idle deadline when available — process more if browser has budget.
    let chunkSize = Editor.LAYOUT_CHUNK_SIZE;
    if (deadline && deadline.timeRemaining() > 8) {
      // Rough heuristic: ~3 blocks/ms for an average doc.
      chunkSize = Math.min(300, Math.floor(deadline.timeRemaining() * 3));
    }
    this._partialLayoutBlocks += chunkSize;

    this.charMap.clear();
    this.populatedPages.clear();
    performance.mark("inscribe:layout-chunk-start");
    this._layout = layoutDocument(this.state.doc, {
      pageConfig: this.pageConfig,
      fontConfig: this.fontConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      measureCache: this.measureCache,
      // Pass resumption so layoutDocument() continues from the next unprocessed
      // block instead of restarting from block 0 — makes each chunk O(chunkSize)
      // rather than O(totalBlocks), for O(N) total cost across all chunks.
      ...(this._layoutResumption ? { resumption: this._layoutResumption } : {}),
      maxBlocks: chunkSize,
    });
    performance.mark("inscribe:layout-chunk-end");
    performance.measure(
      `inscribe:layout-chunk (next ${chunkSize} blocks, total ${this._partialLayoutBlocks} of ${this.state.doc.childCount})`,
      "inscribe:layout-chunk-start",
      "inscribe:layout-chunk-end",
    );
    this._layoutIsPartial = this._layout.isPartial ?? false;
    this._layoutResumption = this._layout.resumption ?? null;
    this._cursorPage = this.cursorPageFromLayout();
    this.ensurePagePopulated(this._cursorPage);
    this.ensurePagePopulated(this._cursorPage - 1);
    this.ensurePagePopulated(this._cursorPage + 1);
    this.notifyListeners();

    if (this._layoutIsPartial) {
      this.scheduleIdleLayout(); // schedule the next chunk
    }
  }

  /**
   * Three-phase loading state for collaborative documents.
   *
   *  'syncing'   — editor created, waiting for the Y.js / HocusPocus server to
   *                deliver the document (setReady(false) is in effect). No
   *                content is visible yet — show a full-screen loading UI.
   *
   *  'rendering' — onSynced fired and the first pages are already painted; idle
   *                callbacks are completing the rest of the layout in the
   *                background. Content is visible and interactive — you can hide
   *                the loading UI and show a subtle progress indicator if you want.
   *
   *  'ready'     — all pages are laid out. For non-collaborative editors this is
   *                the initial state (no sync step needed).
   *
   * The value changes are surfaced through the normal notifyListeners() cycle,
   * so useEditorState() picks them up without any extra wiring:
   *
   *   const loadingState = useEditorState({
   *     editor,
   *     selector: (ctx) => ctx.editor.loadingState,
   *     equalityFn: Object.is,
   *   });
   */
  get loadingState(): "syncing" | "rendering" | "ready" {
    if (!this._ready) return "syncing";
    if (this._layoutIsPartial) return "rendering";
    return "ready";
  }

  /**
   * The page number the cursor currently resides on.
   * Computed once per layout cycle in ensureLayout() — free to read on every
   * overlay paint without re-walking the layout.
   */
  get cursorPage(): number {
    return this._cursorPage;
  }

  /**
   * Finds which layout page the current cursor (selection.head) resides on.
   * Walks layout blocks — pure integer arithmetic, no charmap needed.
   * Falls back to the last page if the position is somehow out of range.
   */
  private cursorPageFromLayout(): number {
    const head = this.state.selection.head;
    for (const page of this._layout.pages) {
      for (const block of page.blocks) {
        if (head >= block.nodePos && head < block.nodePos + block.node.nodeSize) {
          return page.pageNumber;
        }
      }
    }
    return this._layout.pages[this._layout.pages.length - 1]?.pageNumber ?? 1;
  }

  /**
   * Ensures the CharacterMap is populated for the given page.
   * Called eagerly for all pages in ensureLayout().
   * Also called by ViewManager before painting — becomes a no-op when the
   * page is already populated (idempotent via populatedPages set).
   */
  ensurePagePopulated(pageNumber: number): void {
    if (pageNumber < 1) return;
    if (this.populatedPages.has(pageNumber)) return;
    const page = this._layout.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;           // don't mark populated — layout may grow later
    this.populatedPages.add(pageNumber);
    let lineOffset = 0;
    for (const block of page.blocks) {
      populateCharMap(block, this.charMap, page.pageNumber, lineOffset, this.measurer);
      lineOffset += block.lines.length;
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
    // preventScroll: true — belt-and-suspenders guard. The textarea is position:fixed
    // so it has no scroll context, but some browsers still emit a scroll on .focus()
    // for fixed elements if they are off-screen (top:-9999px). This suppresses that.
    this.textarea.focus({ preventScroll: true });
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
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._idleLayoutId !== null) {
      if (typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(this._idleLayoutId);
      } else {
        clearTimeout(this._idleLayoutId);
      }
      this._idleLayoutId = null;
    }
    for (const cleanup of this.editorReadyCleanup) cleanup();
    this.editorReadyCleanup = [];
    this.overlayRenderHandlers.clear();
    this.cursorManager.stop();
    this.unmount();
  }

  focus(): void {
    this.textarea?.focus({ preventScroll: true });
  }

  /**
   * Register a canvas draw function on the overlay layer.
   * Called by ViewManager.paintOverlay() after the local cursor and selection.
   * Returns an unregister function.
   *
   * @example
   * const unregister = editor.addOverlayRenderHandler((ctx, pageNum, config, charMap) => {
   *   // draw remote cursors…
   * });
   */
  addOverlayRenderHandler(handler: OverlayRenderHandler): () => void {
    this.overlayRenderHandlers.add(handler);
    return () => this.overlayRenderHandlers.delete(handler);
  }

  /**
   * Invoke all registered overlay render handlers for a given page.
   * Called by ViewManager.paintOverlay() — not intended for external use.
   */
  runOverlayHandlers(
    ctx: CanvasRenderingContext2D,
    pageNumber: number,
    pageConfig: PageConfig,
  ): void {
    for (const handler of this.overlayRenderHandlers) {
      handler(ctx, pageNumber, pageConfig, this.charMap);
    }
  }

  /**
   * Apply a transaction from an external source (Y.js remote sync, etc.).
   * Bypasses input-bridge positioning that is only relevant for local edits.
   *
   * @internal — prefixed with underscore to signal it's infrastructure-facing.
   */
  _applyTransaction(tr: Transaction): void {
    this.dispatch(tr);
  }

  /**
   * Trigger a UI redraw without a document/selection change.
   * Use when external state (e.g. Y.js awareness) changes and the overlay
   * needs to be repainted with fresh remote cursor positions.
   */
  redraw(): void {
    this.notifyListeners();
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
    if (!this.textarea) return;

    const { head } = this.state.selection;
    // getViewportRect returns the cursor's exact position in viewport coordinates.
    // The textarea is position:fixed so these map directly to its top/left.
    const rect = this.getViewportRect(head, head);
    if (!rect) return;

    Object.assign(this.textarea.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      height: `${rect.height}px`,
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

    // Use scrollTop-relative positions so the calculation is independent of the
    // scroll container's viewport position and its padding.
    //
    // pageEl.getBoundingClientRect().top − scrollParent.getBoundingClientRect().top
    //   gives the page's current offset relative to the container's outer edge.
    // Adding scrollParent.scrollTop converts that to an absolute scroll-area position.
    const containerRect = scrollParent.getBoundingClientRect();
    const pageTop =
      pageEl.getBoundingClientRect().top - containerRect.top + scrollParent.scrollTop;

    const cursorAbsTop = pageTop + coords.y;
    const cursorAbsBottom = cursorAbsTop + coords.height;

    // clientHeight is the visible area height (includes padding, excludes scrollbar/border).
    const visibleTop = scrollParent.scrollTop;
    const visibleBottom = visibleTop + scrollParent.clientHeight;
    const buffer = 40;

    // Only scroll when cursor is outside (or within buffer of) the visible area.
    if (cursorAbsBottom > visibleBottom - buffer) {
      scrollParent.scrollTop = cursorAbsBottom - scrollParent.clientHeight + buffer;
    } else if (cursorAbsTop < visibleTop + buffer) {
      scrollParent.scrollTop = cursorAbsTop - buffer;
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
    const sel = TextSelection.findFrom($pos, -1);
    if (sel) this.applyMovement(sel.head, extend);
  }

  /** Move right one position. Pass extend=true to grow the selection (Shift+→). */
  moveRight(extend = false): void {
    const head = this.state.selection.head;
    const size = this.state.doc.content.size;
    if (head >= size) return;
    const $pos = this.state.doc.resolve(Math.min(size, head + 1));
    const sel = TextSelection.findFrom($pos, 1);
    if (sel) this.applyMovement(sel.head, extend);
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
  /**
   * Returns a MarkdownSerializer configured with all extension-contributed rules.
   * Use this with exportToMarkdown() from @inscribe/export.
   */
  getMarkdownSerializer(): MarkdownSerializer {
    const { nodes, marks } = this.manager.buildMarkdownSerializerRules();
    return new MarkdownSerializer(nodes, marks);
  }

  /** Serialize the full document to Markdown. Implements IEditor.getMarkdown(). */
  getMarkdown(): string {
    return this.getMarkdownSerializer().serialize(this.state.doc);
  }

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
    // resetSilent: reset blink state WITHOUT calling onTick (which fires notifyListeners).
    // The rAF flush below handles the repaint — calling reset() here was the root cause
    // of O(N²) repaints during Y.js initial sync (one full canvas paint per dispatch).
    this.cursorManager.resetSilent();
    this.onChange?.(this.state);
    // Schedule a single rAF flush rather than rendering immediately.
    // Multiple dispatches within the same frame (e.g. Y.js initial sync
    // firing hundreds of typeObserver events) share one layout + one paint,
    // reducing O(N²) sync cost to O(N).
    this.scheduleFlush();
  }

  /**
   * Schedules a layout + render flush for the next animation frame.
   * Idempotent — calling it multiple times before the frame fires is free.
   */
  private scheduleFlush(): void {
    if (!this._ready) return; // suppress during collaborative sync
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this.ensureLayout();
      // ViewManager.update() runs inside notifyListeners (via subscribe),
      // creating any new page DOM elements before we position the textarea.
      this.notifyListeners();
      this.syncInputBridge();
      this.scrollCursorIntoView();
    });
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
      position: "fixed",
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
      top: "-9999px",
      left: "-9999px",
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
    ta.addEventListener("copy", this.handleCopy);
    ta.addEventListener("cut", this.handleCut);
    ta.addEventListener("focus", this.handleFocus);
    ta.addEventListener("blur", this.handleBlur);
  }

  private detachListeners(): void {
    const ta = this.textarea!;
    ta.removeEventListener("keydown", this.handleKeydown);
    ta.removeEventListener("input", this.handleInput);
    ta.removeEventListener("compositionend", this.handleCompositionEnd);
    ta.removeEventListener("paste", this.handlePaste);
    ta.removeEventListener("copy", this.handleCopy);
    ta.removeEventListener("cut", this.handleCut);
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
    // Clear BEFORE dispatching: on Chrome/Edge the browser fires `input` with
    // isComposing=false immediately after compositionend. If the textarea still
    // has text at that point, handleInput would insert it a second time.
    this.clearTextarea();
    this.dispatch(insertText(this.state, text));
  };

  /**
   * Look up the key event in the extension input handlers and run it if found.
   * Returns true when a handler was executed.
   */
  private tryInputHandler(e: KeyboardEvent): boolean {
    // Try the fully-qualified key first (e.g. "Alt-ArrowLeft" for word-jump),
    // then fall back to the bare key (e.g. "ArrowLeft") so that handlers which
    // read modifier state directly (like BaseEditing's arrow handlers) still fire
    // for modifier+arrow combos that have no explicit override registered.
    const handler = this.inputHandlers[keyEventToString(e)] ?? this.inputHandlers[e.key];
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

  private handleCopy = (e: ClipboardEvent): void => {
    const { from, to, empty } = this.state.selection;
    if (empty || !e.clipboardData) return;
    e.preventDefault();
    const text = this.state.doc.textBetween(from, to, "\n");
    e.clipboardData.setData("text/plain", text);
    const html = serializeSelectionToHtml(this.state, this.manager.schema);
    if (html) e.clipboardData.setData("text/html", html);
  };

  private handleCut = (e: ClipboardEvent): void => {
    const { from, to, empty } = this.state.selection;
    if (empty || !e.clipboardData) return;
    e.preventDefault();
    const text = this.state.doc.textBetween(from, to, "\n");
    e.clipboardData.setData("text/plain", text);
    const html = serializeSelectionToHtml(this.state, this.manager.schema);
    if (html) e.clipboardData.setData("text/html", html);
    const tr = deleteSelection(this.state);
    if (tr) this.dispatch(tr);
  };

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
