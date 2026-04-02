import { EditorState, Transaction, TextSelection, NodeSelection } from "prosemirror-state";
import type {
  FontModifier,
  MarkDecorator,
  ToolbarItemSpec,
  OverlayRenderHandler,
  IEditor,
} from "./extensions/types";
import type { Schema } from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";
import { ExtensionManager } from "./extensions/ExtensionManager";
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
  private readonly onChange: EditorChangeHandler | undefined;
  private readonly onFocusChange: ((focused: boolean) => void) | undefined;

  /** Subscriber set — notified on every state change, focus change, and cursor tick. */
  private readonly listeners = new Set<() => void>();

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
   * Bound command map — each entry calls the extension command with the
   * current state + this editor's dispatch. Built once; closures over `this`
   * so they always read the latest state at call time.
   */
  readonly commands: Record<string, (...args: unknown[]) => void>;

  /**
   * Overlay render handlers registered by extensions (e.g. CollaborationCursor).
   * Called by ViewManager.paintOverlay() for each visible page.
   */
  private readonly overlayRenderHandlers = new Set<OverlayRenderHandler>();

  /** Cleanup functions returned by onEditorReady() callbacks — called on destroy(). */
  private editorReadyCleanup: Array<() => void> = [];

  constructor({
    extensions = [StarterKit],
    pageConfig,
    onChange,
    onFocusChange,
    onCursorTick,
    startReady = true,
  }: EditorOptions) {
    this.manager = new ExtensionManager(extensions);
    this.onChange = onChange;
    this.onFocusChange = onFocusChange;
    const builtConfig = this.manager.buildPageConfig();
    // User-supplied pageConfig overrides extension-built config so that
    // top-level options like fontFamily are always respected.
    this.pageConfig = builtConfig && pageConfig
      ? { ...builtConfig, ...pageConfig }
      : builtConfig ?? pageConfig ?? defaultPageConfig;
    this.fontConfig = this.manager.buildBlockStyles();
    this.measurer = new TextMeasurer({ lineHeightMultiplier: 1.2 });
    this.fontModifiers = this.manager.buildFontModifiers();
    this.markDecorators = this.manager.buildMarkDecorators();
    this.toolbarItems = this.manager.buildToolbarItems();
    this.blockRegistry = this.manager.buildBlockRegistry();
    this.inlineRegistry = this.manager.buildInlineRegistry();
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

    this.lc = new LayoutCoordinator({
      pageConfig: this.pageConfig,
      fontConfig: this.fontConfig,
      measurer: this.measurer,
      fontModifiers: this.fontModifiers,
      getDoc: () => this.state.doc,
      getHead: () => this.state.selection.head,
      onUpdate: () => this.notifyListeners(),
    });

    // If startReady:false, cancel the idle layout and suppress all flushes
    // until setReady(true) is called (e.g. from provider.on('synced', ...)).
    if (!startReady) {
      this.lc.setReady(false);
    }

    this.commands = this.buildCommands();

    const pasteTransformer = new PasteTransformer(
      this.manager.schema,
      this.manager.buildMarkdownRules(),
      this.manager.buildMarkdownParserTokens(),
    );

    this.ib = new InputBridge({
      getState: () => this.state,
      dispatch: (tr) => this.dispatch(tr),
      getSchema: () => this.manager.schema,
      getViewportRect: (from, to) => this.getViewportRect(from, to),
      getCharMap: () => this.lc.charMap,
      getFloatPosition: (docPos: number) => {
        const f = this.layout.floats?.find((fl) => fl.docPos === docPos);
        if (!f) return null;
        return { page: f.page, y: f.y, height: f.height };
      },
      keymap: this.manager.buildKeymap(),
      inputHandlers: this.manager.buildInputHandlers(),
      navigator: this,
      pasteTransformer,
      onFocus: () => {
        this.cursorManager.start();
        this.notifyListeners();
        this.onFocusChange?.(true);
      },
      onBlur: () => {
        this.cursorManager.stop();
        this.notifyListeners();
        this.onFocusChange?.(false);
      },
    });

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
    if (!ready && this._rafId !== null) {
      // Cancel any pending flush before going unready to prevent a stale render.
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.lc.setReady(ready);
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
   * The CharacterMap — glyph positions for hit-testing and cursor rendering.
   * Owned by the LayoutCoordinator; exposed here so ViewManager and adapters
   * can access it without knowing about the coordinator.
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
   * Convert a doc position range to a viewport DOMRect.
   *
   * Uses the CharacterMap for pixel-accurate canvas coordinates, then offsets
   * by the page element's viewport position (registered by the rendering adapter
   * via setPageTopLookup). Returns null if either position is not in the
   * CharacterMap or if no adapter has registered a page element lookup.
   *
   * The returned rect spans from the `from` position to the `to` position.
   * If both positions are on different lines, the rect uses the `from` line's
   * y/height and extends to the right edge of the available content width.
   */
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
   * Falls back to moveCursorTo if the node is not selectable.
   */
  selectNode(docPos: number): void {
    try {
      const sel = NodeSelection.create(this.state.doc, docPos);
      this.dispatch(this.state.tr.setSelection(sel));
      this.focus();
    } catch {
      this.moveCursorTo(docPos);
    }
  }

  /** Merge attrs into the node at docPos. No-op if no node exists there. */
  setNodeAttrs(docPos: number, attrs: Record<string, unknown>): void {
    const node = this.state.doc.nodeAt(docPos);
    if (!node) return;
    this.dispatch(this.state.tr.setNodeMarkup(docPos, undefined, { ...node.attrs, ...attrs }));
  }

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

    // Width: span to toCoords if on same line, otherwise use a minimal 1px width
    const sameLine =
      toCoords &&
      toCoords.page === fromCoords.page &&
      Math.abs(toCoords.y - fromCoords.y) < 2;
    const width =
      sameLine && toCoords ? Math.abs(toCoords.x - fromCoords.x) : 1;

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
    this.lc.ensureLayout();
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
    return this.lc.loadingState;
  }

  /**
   * The page number the cursor currently resides on.
   * Computed once per layout cycle in ensureLayout() — free to read on every
   * overlay paint without re-walking the layout.
   */
  get cursorPage(): number {
    return this.lc.cursorPage;
  }

  /**
   * Ensures the CharacterMap is populated for the given page.
   * Called eagerly for cursor page ± 1 after every layout pass.
   * Also called by ViewManager before painting — idempotent.
   */
  ensurePagePopulated(pageNumber: number): void {
    this.lc.ensurePagePopulated(pageNumber);
  }

  /**
   * Returns a lightweight snapshot of the current selection state.
   * Includes everything a toolbar or floating menu needs — no CharacterMap
   * or layout internals required.
   *
   * Ensures layout is current before computing.
   */
  getSelectionSnapshot(): SelectionSnapshot {
    this.lc.ensureLayout();
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
    this.ib.mount(container);
  }

  /**
   * Tear down the mounted view (textarea + event listeners) without
   * destroying the Editor itself. Safe to call multiple times.
   * After unmount the editor can be re-mounted with mount().
   */
  unmount(): void {
    this.ib.unmount();
  }

  destroy(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.lc.destroy();
    for (const cleanup of this.editorReadyCleanup) cleanup();
    this.editorReadyCleanup = [];
    this.overlayRenderHandlers.clear();
    this.cursorManager.stop();
    this.unmount();
  }

  focus(): void {
    this.ib.focus();
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
      handler(ctx, pageNumber, pageConfig, this.lc.charMap);
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
    this.renderGeneration++;
    this.notifyListeners();
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
   * Delegates to InputBridge.syncPosition().
   */
  syncInputBridge(): void {
    this.ib.syncPosition();
  }

  /**
   * Scrolls the nearest scrollable ancestor so the cursor is visible.
   * Called after every state change and after React renders new pages.
   */
  scrollCursorIntoView(): void {
    this.ib.scrollCursorIntoView();
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
    this.dispatch(this.state.tr.setSelection(TextSelection.between($a, $h)));
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
    this.lc.ensureLayout();
    const head = this.state.selection.head;
    const coords = this.lc.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.lc.charMap.posAbove(head, coords.x);
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
   * Use this with exportToMarkdown() from @scrivr/export.
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
    return this.ib.isFocused;
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
    this.lc.ensureLayout();
    const head = this.state.selection.head;
    const coords = this.lc.charMap.coordsAtPos(head);
    if (!coords) return;
    const pos = this.lc.charMap.posBelow(head, coords.x);
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
    this.dispatch(this.state.tr.setSelection(TextSelection.between($a, $h)));
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  private dispatch(tr: Transaction | null): void {
    if (!tr) return;
    this.state = this.state.apply(tr);
    this.lc.invalidate();
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
    if (!this.lc.isReady) return; // suppress during collaborative sync
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this.lc.ensureLayout();
      // Scroll first so the viewport is settled, then notify subscribers.
      // This ensures getNodeViewportRect / getViewportRect return post-scroll
      // screen coordinates, preventing a one-frame popover position jump.
      this.scrollCursorIntoView();
      this.syncInputBridge();
      this.notifyListeners();
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
}
