import { EditorState, Transaction, NodeSelection } from "prosemirror-state";
import { SelectionController } from "./SelectionController";
import type {
  FontModifier,
  MarkDecorator,
  ToolbarItemSpec,
  OverlayRenderHandler,
  IEditor,
} from "./extensions/types";
import type { Schema } from "prosemirror-model";
import { StarterKit } from "./extensions/StarterKit";
import { BlockRegistry, InlineRegistry } from "./layout/BlockRegistry";
import type { Extension } from "./extensions/Extension";
import { CursorManager } from "./renderer/CursorManager";
import { TextMeasurer } from "./layout/TextMeasurer";
import { defaultPageConfig } from "./layout/PageLayout";
import type { PageConfig, DocumentLayout } from "./layout/PageLayout";
import type { FontConfig } from "./layout/FontConfig";
import { LayoutCoordinator } from "./layout/LayoutCoordinator";
import type { CharacterMap } from "./layout/CharacterMap";
import { InputBridge } from "./input/InputBridge";
import { PasteTransformer } from "./input/PasteTransformer";
import { BaseEditor } from "./BaseEditor";
import type { EditorEvents } from "./types/augmentation";

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
  /**
   * Start the editor in read-only / view mode.
   * Can also be toggled at any time via `editor.setReadOnly(value)`.
   * Defaults to false.
   */
  readOnly?: boolean;
}

/**
 * Editor — the full browser editor. Extends `BaseEditor` with layout,
 * canvas rendering, input capture, and cursor management.
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
export class Editor extends BaseEditor implements IEditor {
  private readonly _onChange: EditorChangeHandler | undefined;
  private readonly _onFocusChange: ((focused: boolean) => void) | undefined;

  /**
   * Incremented by redraw() to signal asset-only repaints (e.g. image load).
   * TileManager compares against this to bypass the layout-version paint guard.
   */
  renderGeneration = 0;

  /** Page dimensions and margins — passed to LayoutCoordinator and read by renderers. */
  readonly pageConfig: PageConfig;

  /** The text measurer — created once; its internal caches are reused across layouts. */
  readonly measurer: TextMeasurer;

  // ── Layout coordinator ────────────────────────────────────────────────────

  /** Owns all layout state: DocumentLayout, CharacterMap, dirty/partial flags,
   *  measure cache, and idle-callback scheduling. */
  private readonly lc: LayoutCoordinator;

  /**
   * requestAnimationFrame handle for the pending render flush.
   * Multiple dispatch() calls within the same frame share a single flush,
   * collapsing e.g. hundreds of Y.js sync operations into one layout + one paint.
   */
  private _rafId: number | null = null;

  // ── Input bridge ──────────────────────────────────────────────────────────

  /** Owns all cursor movement, selection, and word/line navigation logic. */
  readonly selection: SelectionController;

  /** Owns the hidden textarea, all DOM event listeners, and clipboard handling. */
  private readonly ib: InputBridge;

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
   * Inline object registry built from all extensions.
   * Pass to renderPage — maps node type names to InlineStrategy instances.
   */
  readonly inlineRegistry: InlineRegistry;

  /**
   * Overlay render handlers registered by extensions (e.g. CollaborationCursor).
   * Called by TileManager.paintOverlay() for each visible page.
   */
  private readonly overlayRenderHandlers = new Set<OverlayRenderHandler>();

  constructor({
    extensions = [StarterKit],
    pageConfig,
    onChange,
    onFocusChange,
    onCursorTick,
    startReady = true,
    readOnly = false,
  }: EditorOptions) {
    // BaseEditor handles: manager, state, commands, storage, event emitter
    super({ extensions });

    this._onChange = onChange;
    this._onFocusChange = onFocusChange;

    const builtConfig = this._manager.buildPageConfig();
    // User-supplied pageConfig overrides extension-built config so that
    // top-level options like fontFamily are always respected.
    this.pageConfig = builtConfig && pageConfig
      ? { ...builtConfig, ...pageConfig }
      : builtConfig ?? pageConfig ?? defaultPageConfig;

    this.fontConfig    = this._manager.buildBlockStyles();
    this.measurer      = new TextMeasurer({ lineHeightMultiplier: 1.2 });
    this.fontModifiers = this._manager.buildFontModifiers();
    this.markDecorators = this._manager.buildMarkDecorators();
    this.toolbarItems  = this._manager.buildToolbarItems();
    this.blockRegistry = this._manager.buildBlockRegistry();
    this.inlineRegistry = this._manager.buildInlineRegistry();

    this.cursorManager = new CursorManager(() => {
      onCursorTick?.(this.cursorManager.isVisible);
      this._notifyListeners();
    });

    this.lc = new LayoutCoordinator({
      pageConfig: this.pageConfig,
      fontConfig: this.fontConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      getDoc: () => this._state.doc,
      getHead: () => this._state.selection.head,
      onUpdate: () => this._notifyListeners(),
    });

    // If startReady:false, cancel the idle layout and suppress all flushes
    // until setReady(true) is called (e.g. from provider.on('synced', ...)).
    if (!startReady) {
      this.lc.setReady(false);
    }

    this.selection = new SelectionController({
      getState: () => this._state,
      dispatch: (tr) => this._viewDispatch(tr),
      ensureLayout: () => this.lc.ensureLayout(),
      getCharMap: () => this.lc.charMap,
      focus: () => this.focus(),
    });

    const pasteTransformer = new PasteTransformer(
      this._manager.schema,
      this._manager.buildMarkdownRules(),
      this._manager.buildMarkdownParserTokens(),
    );

    this.ib = new InputBridge({
      getState: () => this._state,
      dispatch: (tr) => { if (tr) this._viewDispatch(tr); },
      getSchema: () => this._manager.schema,
      getViewportRect: (from, to) => this.getViewportRect(from, to),
      getCharMap: () => this.lc.charMap,
      getFloatPosition: (docPos: number) => {
        const f = this.layout.floats?.find((fl) => fl.docPos === docPos);
        if (!f) return null;
        return { page: f.page, y: f.y, height: f.height };
      },
      keymap: this._manager.buildKeymap(),
      inputHandlers: this._manager.buildInputHandlers(),
      navigator: this.selection,
      pasteTransformer,
      onFocus: () => {
        this.cursorManager.start();
        this._notifyListeners();
        this._onFocusChange?.(true);
        this.emit("focus", undefined as EditorEvents["focus"]);
      },
      onBlur: () => {
        this.cursorManager.stop();
        this._notifyListeners();
        this._onFocusChange?.(false);
        this.emit("blur", undefined as EditorEvents["blur"]);
      },
    });

    // Apply initial read-only state after infrastructure is ready.
    if (readOnly) this.setReadOnly(true);

    // Fire onEditorReady after ALL infrastructure (including view) is set up.
    this._fireEditorReady();
  }

  // ── BaseEditor overrides ─────────────────────────────────────────────────

  /**
   * Override: route through the view-aware dispatch (layout invalidation + rAF).
   * This ensures external transaction sources (Y.js, AI suggestions) also
   * trigger layout + paint updates.
   */
  override _applyTransaction(tr: Transaction): void {
    this._viewDispatch(tr);
  }

  /**
   * Override: commands also go through the view-aware dispatch so every
   * command triggers layout + paint.
   */
  protected override _dispatchForCommands(tr: Transaction): void {
    this._viewDispatch(tr);
  }

  /**
   * Override: gate InputBridge mutations and cursor blink in addition to
   * setting the flag and notifying subscribers.
   */
  override setReadOnly(value: boolean): void {
    if (this.readOnly === value) return;
    super.setReadOnly(value);
    this.ib.setReadOnly(value);
    if (value) {
      this.cursorManager.stop();
    } else if (this.ib.isFocused) {
      this.cursorManager.start();
    }
  }

  /** Override to use full view dispatch so setNodeAttrs triggers a repaint. */
  override setNodeAttrs(docPos: number, attrs: Record<string, unknown>): void {
    const node = this._state.doc.nodeAt(docPos);
    if (!node) return;
    this._viewDispatch(
      this._state.tr.setNodeMarkup(docPos, undefined, { ...node.attrs, ...attrs }),
    );
  }

  override destroy(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    super.destroy(); // emits "destroy", fires cleanup callbacks
    this.lc.destroy();
    this.overlayRenderHandlers.clear();
    this.cursorManager.stop();
    this.unmount();
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
   */
  setReady(ready: boolean): void {
    if (!ready && this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.lc.setReady(ready);
  }

  /** The merged ProseMirror Schema built from all extensions. */
  override get schema(): Schema {
    return this._manager.schema;
  }

  /**
   * The CharacterMap — glyph positions for hit-testing and cursor rendering.
   */
  get charMap(): CharacterMap {
    return this.lc.charMap;
  }

  /**
   * The current document layout. Calls ensureLayout() so the result
   * always reflects the latest EditorState.
   */
  get layout(): DocumentLayout {
    this.lc.ensureLayout();
    return this.lc.current;
  }

  /** True when the editor is in pageless (infinite-scroll) mode. */
  get isPageless(): boolean {
    return this.pageConfig.pageless === true;
  }

  /**
   * Three-phase loading state for collaborative documents.
   */
  get loadingState(): "syncing" | "rendering" | "ready" {
    return this.lc.loadingState;
  }

  /**
   * The page number the cursor currently resides on.
   */
  get cursorPage(): number {
    return this.lc.cursorPage;
  }

  /**
   * Convert a doc position range to a viewport DOMRect.
   */
  getViewportRect(from: number, to: number): DOMRect | null {
    this.lc.ensureLayout();

    const fromCoords = this.lc.charMap.coordsAtPos(from);
    if (!fromCoords) return null;

    const pageScreenRect = this.ib.lookupPageScreenRect(fromCoords.page);
    if (!pageScreenRect) return null;

    const toCoords = this.lc.charMap.coordsAtPos(to);

    const left = pageScreenRect.screenLeft + fromCoords.x;
    const top  = pageScreenRect.screenTop  + fromCoords.y;
    const height = fromCoords.height;

    const sameLine =
      toCoords &&
      toCoords.page === fromCoords.page &&
      Math.abs(toCoords.y - fromCoords.y) < 2;
    const width =
      sameLine && toCoords ? Math.abs(toCoords.x - fromCoords.x) : 1;

    return new DOMRect(left, top, Math.max(1, width), height);
  }

  getNodeViewportRect(docPos: number): DOMRect | null {
    this.lc.ensureLayout();
    const rect = this.lc.charMap.getObjectRect(docPos);
    if (!rect) return null;
    const pageScreenRect = this.ib.lookupPageScreenRect(rect.page);
    if (!pageScreenRect) return null;
    return new DOMRect(
      pageScreenRect.screenLeft + rect.x,
      pageScreenRect.screenTop  + rect.y,
      rect.width, rect.height,
    );
  }

  /**
   * Select the inline node at docPos using a NodeSelection.
   * Falls back to selection.moveCursorTo if the node is not selectable.
   */
  selectNode(docPos: number): void {
    try {
      const sel = NodeSelection.create(this._state.doc, docPos);
      this._viewDispatch(this._state.tr.setSelection(sel));
      this.focus();
    } catch {
      this.selection.moveCursorTo(docPos);
    }
  }

  /**
   * Guarantees the layout reflects the current EditorState.
   */
  ensureLayout(): void {
    this.lc.ensureLayout();
  }

  /**
   * Ensures the CharacterMap is populated for the given page.
   */
  ensurePagePopulated(pageNumber: number): void {
    this.lc.ensurePagePopulated(pageNumber);
  }

  /**
   * Returns a lightweight snapshot of the current selection state.
   */
  getSelectionSnapshot(): SelectionSnapshot {
    this.lc.ensureLayout();
    const { selection } = this._state;
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
    this.ib.mount(container);
  }

  /**
   * Tear down the mounted view (textarea + event listeners) without
   * destroying the Editor itself. Safe to call multiple times.
   */
  unmount(): void {
    this.ib.unmount();
  }

  focus(): void {
    this.ib.focus();
  }

  /**
   * Register a canvas draw function on the overlay layer.
   * Called by TileManager.paintOverlay() after the local cursor and selection.
   * Returns an unregister function.
   */
  addOverlayRenderHandler(handler: OverlayRenderHandler): () => void {
    this.overlayRenderHandlers.add(handler);
    return () => this.overlayRenderHandlers.delete(handler);
  }

  /**
   * Invoke all registered overlay render handlers for a given page.
   * Called by TileManager.paintOverlay() — not intended for external use.
   */
  runOverlayHandlers(
    ctx: CanvasRenderingContext2D,
    pageNumber: number,
    pageConfig: PageConfig,
  ): void {
    for (const handler of this.overlayRenderHandlers) {
      handler(ctx, pageNumber, pageConfig, this.lc.charMap);
    }
  }

  /**
   * Trigger a UI redraw without a document/selection change.
   * Use when external state (e.g. Y.js awareness) changes and the overlay
   * needs to be repainted with fresh remote cursor positions.
   */
  redraw(): void {
    this.renderGeneration++;
    this._notifyListeners();
  }

  /**
   * Register a function that returns the screen-space top-left corner of
   * page N. Used by scrollCursorIntoView, getViewportRect, and
   * getNodeViewportRect — no DOM element per page needed.
   */
  setPageTopLookup(
    fn: ((page: number) => { screenLeft: number; screenTop: number } | null) | null,
  ): void {
    this.ib.setPageScreenRectLookup(fn);
  }

  /**
   * Positions the hidden textarea at the cursor's visual location.
   */
  syncInputBridge(): void {
    this.ib.syncPosition();
  }

  /**
   * Scrolls the nearest scrollable ancestor so the cursor is visible.
   */
  scrollCursorIntoView(): void {
    this.ib.scrollCursorIntoView();
  }

  /** Whether the editor's textarea currently has focus. */
  get isFocused(): boolean {
    return this.ib.isFocused;
  }

  /**
   * Returns the current ProseMirror EditorState.
   * Used as the getSnapshot function for useSyncExternalStore.
   */
  getSnapshot(): EditorState {
    return this._state;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * The view-aware dispatch: applies state + invalidates layout + resets
   * cursor blink + calls onChange + schedules rAF flush.
   *
   * All transaction paths in Editor (commands, input, external) converge here.
   */
  private _viewDispatch(tr: Transaction): void {
    // _applyState is in BaseEditor: applies tr, emits "update", notifyListeners
    this._applyState(tr);
    this.lc.invalidate();
    // resetSilent: reset blink state WITHOUT calling onTick (which fires notifyListeners).
    // Calling reset() here was the root cause of O(N²) repaints during Y.js initial sync.
    this.cursorManager.resetSilent();
    this._onChange?.(this._state);
    this._scheduleFlush();
  }

  /**
   * Schedules a layout + render flush for the next animation frame.
   * Idempotent — calling it multiple times before the frame fires is free.
   */
  private _scheduleFlush(): void {
    if (!this.lc.isReady) return; // suppress during collaborative sync
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this.lc.ensureLayout();
      // Scroll first so the viewport is settled, then notify subscribers.
      this.scrollCursorIntoView();
      this.syncInputBridge();
      this._notifyListeners();
    });
  }
}
