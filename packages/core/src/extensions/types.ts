/**
 * Extension system types.
 *
 * An Extension bundles everything needed to add a capability to the editor:
 *   - Schema contribution  (ProseMirror nodes/marks)
 *   - Behaviour            (commands, keymap, ProseMirror plugins)
 *   - Layout               (measure strategy for block nodes)
 *   - Render               (mark decorators for canvas)
 *
 * Three-phase resolution:
 *   Phase 1 — addNodes / addMarks      → ExtensionManager builds the Schema
 *   Phase 2 — addKeymap / addCommands  → called with the built Schema in context
 *   Phase 3 — addLayoutHandler / addMarkDecorators → wired into BlockRegistry + renderer
 */

import type { NodeSpec, MarkSpec, AttributeSpec, Schema, Node, Mark } from "prosemirror-model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Command, Plugin, Transaction, EditorState } from "prosemirror-state";
import type { EditorEvents } from "../types/augmentation";
import type { InputRule } from "prosemirror-inputrules";
import type { CharacterMap } from "../layout/CharacterMap";
import type { PageConfig, DocumentLayout } from "../layout/PageLayout";
import type { BlockStrategy, InlineStrategy } from "../layout/BlockRegistry";
import type { BlockStyle } from "../layout/FontConfig";
import type { ParsedFont } from "../layout/StyleResolver";
import type { SelectionController } from "../SelectionController";

// ── Overlay render handler ─────────────────────────────────────────────────────

/**
 * A function registered via editor.addOverlayRenderHandler() that draws
 * additional content on the overlay canvas for a specific page.
 *
 * Called once per visible page after the built-in cursor/selection are drawn.
 * The ctx is already scaled by dpr — draw in logical CSS pixels.
 *
 * @example
 * // CollaborationCursor uses this to draw remote users' cursors
 * editor.addOverlayRenderHandler((ctx, pageNumber, pageConfig, charMap) => { ... });
 */
export type OverlayRenderHandler = (
  ctx: CanvasRenderingContext2D,
  pageNumber: number,
  pageConfig: PageConfig,
  charMap: CharacterMap,
) => void;

// ── Editor interfaces (avoids circular import Editor ↔ extensions) ────────────

/**
 * The base editor interface — everything that works without a visual surface.
 * Implemented by both `Editor` (browser) and `ServerEditor` (Node.js).
 *
 * Use this type in extensions that need to work in both environments:
 * `onEditorReady(editor: IBaseEditor)`.
 *
 * Extensions that require canvas overlays or DOM access should cast to `IEditor`
 * inside `onEditorReady`:
 *   `(editor as IEditor).addOverlayRenderHandler(...)`
 */
export interface IBaseEditor {
  /** Subscribe to all editor notifications (state change, focus, cursor tick). */
  subscribe(listener: () => void): () => void;
  /** Subscribe to a typed editor event. Returns an unsubscribe function. */
  on<K extends keyof EditorEvents>(event: K, handler: (payload: EditorEvents[K]) => void): () => void;
  /** Current ProseMirror state. */
  getState(): EditorState;
  /** True when the editor is in read-only / view mode. */
  get readOnly(): boolean;
  /** Enable or disable read-only / view mode. Notifies subscribers. */
  setReadOnly(value: boolean): void;
  /**
   * Update the attrs of the node at docPos, merging with its current attrs.
   * No-op if there is no node at that position.
   */
  setNodeAttrs(docPos: number, attrs: Record<string, unknown>): void;
  /** Apply a transaction from an external source (e.g. Y.js remote sync). */
  _applyTransaction(tr: Transaction): void;
  /** Serialize the full document to Markdown. Used by AiToolkitAPI. */
  getMarkdown(): string;
}

/**
 * The full view editor interface — adds canvas overlay and DOM methods.
 * Implemented only by `Editor` (browser).
 *
 * Extensions receive this in `onEditorReady` when cast from `IBaseEditor`:
 *   `const viewEditor = editor as IEditor;`
 */
export interface IEditor extends IBaseEditor {
  /** Register a canvas draw function for the overlay layer. Returns unregister. */
  addOverlayRenderHandler(handler: OverlayRenderHandler): () => void;
  /** Current document layout (lazily recomputed when dirty). */
  get layout(): DocumentLayout;
  /**
   * Convert a doc position range to a viewport DOMRect.
   * Returns null if the positions are not in the CharacterMap yet or if no
   * page element lookup has been registered (i.e. editor not mounted).
   */
  getViewportRect(from: number, to: number): DOMRect | null;
  /**
   * Returns the full visual viewport rect of the inline object at docPos
   * (image, widget). Unlike getViewportRect, this uses the actual object
   * render bounds — not the cursor-sized glyph — so the rect height matches
   * the real image height and rect.bottom is the correct anchor for a popover.
   * Returns null if the object has not been rendered yet.
   */
  getNodeViewportRect(docPos: number): DOMRect | null;
  /**
   * Current viewport DOMRect of the scrollable container, or null when no
   * scroll container is attached. Popover controllers use this to hide when
   * the anchor scrolls above/below the visible content area.
   */
  getScrollContainerRect(): DOMRect | null;
  /**
   * Select the inline node at docPos using a ProseMirror NodeSelection.
   * Falls back to selection.moveCursorTo if the position is not selectable.
   */
  selectNode(docPos: number): void;
  /** Trigger a redraw without a state change (e.g. on awareness update). */
  redraw(): void;
  /**
   * Signal that the editor is (or is no longer) ready to render.
   * Call setReady(false) before a collaborative provider connects to suppress
   * layout/paint during Y.js sync. Call setReady(true) from onSynced to do
   * one fast chunked layout of the complete document.
   */
  setReady(ready: boolean): void;
  /**
   * Three-phase loading state. Changes are surfaced via subscribe() so
   * useEditorState() picks them up automatically:
   *
   *   const loadingState = useEditorState({
   *     editor,
   *     selector: (ctx) => ctx.editor.loadingState,
   *     equalityFn: Object.is,
   *   });
   *
   *  'syncing'   — waiting for collaborative sync (no content yet)
   *  'rendering' — first pages visible, idle layout running in background
   *  'ready'     — fully loaded
   */
  get loadingState(): "syncing" | "rendering" | "ready";
  /** Selection controller — cursor movement, word/line navigation, selection. */
  readonly selection: SelectionController;
}

/**
 * Declares how a mark extension modifies the CSS font string.
 * Called by resolveFont for each mark on a text node.
 */
export type FontModifier = (parsed: ParsedFont, attrs: Record<string, unknown>) => void;

// ── Markdown parser / serializer types ────────────────────────────────────────

/**
 * Minimal markdown-it Token interface.
 * Avoids @types/markdown-it as a hard peer dep — covers all attributes used
 * by built-in token handlers (tag, info, attrGet).
 */
export interface MarkdownToken {
  attrGet(name: string): string | null;
  /** e.g. "h1", "h2" for heading tokens */
  tag: string;
  /** Fenced code block language hint */
  info: string;
}

/**
 * ParseSpec for prosemirror-markdown's MarkdownParser.
 * Maps a markdown-it token name to a ProseMirror node or mark.
 */
export interface MarkdownParserTokenSpec {
  /** Map to a self-closing ProseMirror node (e.g. "horizontalRule") */
  node?: string;
  /** Map to a ProseMirror block node — the parser looks for <name>_open / <name>_close tokens */
  block?: string;
  /** Map to a ProseMirror mark — the parser looks for <name>_open / <name>_close tokens */
  mark?: string;
  attrs?: Record<string, unknown> | null;
  getAttrs?: (tok: MarkdownToken) => Record<string, unknown> | null;
  /** Silently skip this token (for self-closing tokens without a schema equivalent) */
  ignore?: boolean;
  /** Token has no separate close token (e.g. code_block) */
  noCloseToken?: boolean;
}

/** Node serializer function for prosemirror-markdown's MarkdownSerializer. */
export type MarkdownNodeSerializer = (
  state: MarkdownSerializerState,
  node: Node,
  parent: Node,
  index: number,
) => void;

/** Mark serializer spec for prosemirror-markdown's MarkdownSerializer. */
export interface MarkdownMarkSerializer {
  open:
    | string
    | ((
        state: MarkdownSerializerState,
        mark: Mark,
        parent: Node,
        index: number,
      ) => string);
  close:
    | string
    | ((
        state: MarkdownSerializerState,
        mark: Mark,
        parent: Node,
        index: number,
      ) => string);
  mixable?: boolean;
  expelEnclosingWhitespace?: boolean;
  escape?: boolean;
}

/** Combined serializer rules contributed by one extension. */
export interface MarkdownSerializerRules {
  nodes?: Record<string, MarkdownNodeSerializer>;
  marks?: Record<string, MarkdownMarkSerializer>;
}

/**
 * A single block-level markdown pattern contributed by an extension.
 * PasteTransformer tries custom rules before its built-in heading/list handlers.
 *
 * @example
 * // HorizontalRule contributing "---" → horizontalRule node
 * {
 *   pattern: /^---+$/,
 *   createNode(match, schema) { return schema.nodes.horizontalRule?.create() ?? null; },
 * }
 */
export interface MarkdownBlockRule {
  /** Tested against each trimmed line of pasted text. */
  pattern: RegExp;
  /**
   * Called when pattern matches. Return a ProseMirror Node or null to fall through.
   * parseInline is the paste transformer's inline parser — use it to support
   * **bold** / *italic* inside custom block content.
   */
  createNode(
    match: RegExpMatchArray,
    schema: Schema,
    parseInline: (text: string) => Node[],
  ): Node | null;
}

/**
 * Describes a toolbar button declared by an extension.
 * Core data only — no React, no DOM.
 */
export interface ToolbarItemSpec {
  /** The command name to call on editor.commands */
  command: string;
  /** Extra arguments passed verbatim to the command when this item is activated */
  args?: unknown[];
  /** Display content, e.g. "B" or "I" */
  label: string;
  /** Tooltip text, e.g. "Bold (⌘B)" */
  title: string;
  /** Inline style applied to the label element — useful for color swatches */
  labelStyle?: Record<string, string | number>;
  /**
   * Logical group name — the Toolbar renders a divider between adjacent items
   * that belong to different groups. Extensions in the same visual section
   * should share a group name (e.g. "format", "heading", "size", "family").
   */
  group?: string;
  /**
   * Returns true when this item should appear active/pressed.
   * The 4th param (activeMarkAttrs) is optional — existing 3-param functions still work.
   */
  isActive: (
    activeMarks: string[],
    blockType: string,
    blockAttrs: Record<string, unknown>,
    activeMarkAttrs?: Record<string, Record<string, unknown>>
  ) => boolean;
}

// ── Mark decorator ─────────────────────────────────────────────────────────────

/**
 * The bounding box of a text span as rendered on the canvas.
 * Coordinates are page-local (not scroll-adjusted).
 */
export interface SpanRect {
  x: number;
  y: number;        // baseline y
  width: number;
  ascent: number;   // pixels above baseline
  descent: number;  // pixels below baseline
  /** Attributes from the mark that triggered this decorator */
  markAttrs: Record<string, unknown>;
}

/**
 * Visual hooks for a mark — runs during canvas rendering.
 *
 * The renderer draws glyphs in this order for each span:
 *   1. decoratePre  (all marks)    — backgrounds, highlights
 *   2. fillText                    — the actual text
 *   3. decoratePost (all marks)    — overlays, strikethrough, underline
 *
 * Both methods are optional. A mark that only affects font metrics (bold, italic)
 * doesn't need a decorator at all — StyleResolver handles those via font string.
 */
export interface MarkDecorator {
  decoratePre?(ctx: CanvasRenderingContext2D, rect: SpanRect): void;
  /**
   * Returns a CSS color string to use as fillStyle when drawing this span's text,
   * or undefined to keep the default. Called after decoratePre, before fillText.
   * Multiple marks on the same span may implement this; the last non-undefined
   * value wins.
   */
  decorateFill?(rect: SpanRect): string | undefined;
  decoratePost?(ctx: CanvasRenderingContext2D, rect: SpanRect): void;
}

// ── Input handler ─────────────────────────────────────────────────────────────

/**
 * Narrow interface for editor-level navigation.
 * Extensions import this instead of the full Editor class to avoid circular deps.
 */
export interface EditorNavigator {
  moveLeft(extend?: boolean): void;
  moveRight(extend?: boolean): void;
  moveUp(extend?: boolean): void;
  moveDown(extend?: boolean): void;
  moveWordLeft(extend?: boolean): void;
  moveWordRight(extend?: boolean): void;
  moveToLineStart(extend?: boolean): void;
  moveToLineEnd(extend?: boolean): void;
  moveToDocStart(extend?: boolean): void;
  moveToDocEnd(extend?: boolean): void;
  deleteWordBackward(): void;
  deleteWordForward(): void;
}

/**
 * Handler for an editor-level key event.
 * Receives a navigator (the Editor) and the raw KeyboardEvent.
 * Return true when handled — the caller will preventDefault().
 */
export type InputHandler = (nav: EditorNavigator, e: KeyboardEvent) => boolean;

// ── Extension context ─────────────────────────────────────────────────────────

/**
 * Context available in Phase 1 callbacks (addNodes, addMarks).
 * Schema is not available yet — it's still being built.
 */
export interface Phase1Context<Options = object> {
  readonly name: string;
  readonly options: Options;
}

/**
 * Context passed as `this` to Phase 2 callbacks (addKeymap, addCommands, addProseMirrorPlugins).
 * The Schema is available because Phase 1 has already run for all extensions.
 */
export interface ExtensionContext<Options = object> extends Phase1Context<Options> {
  readonly schema: Schema;
}

// ── Extension config (what you pass to Extension.create) ─────────────────────

export interface ExtensionConfig<Options = object> {
  name: string;

  /** Default options — shallow-merged with consumer overrides via configure() */
  defaultOptions?: Partial<Options>;

  // ── Phase 1: Schema ─────────────────────────────────────────────────────────
  // Called with `this = Phase1Context` — options available, schema is not yet built.

  /** Contribute ProseMirror node specs. Keys become schema node type names. */
  addNodes?(this: Phase1Context<Options>): Record<string, NodeSpec>;

  /** Contribute ProseMirror mark specs. Keys become schema mark type names. */
  addMarks?(this: Phase1Context<Options>): Record<string, MarkSpec>;

  /**
   * Contribute attributes to the `doc` node at schema-build time.
   * Duplicate attr names across extensions throw at build time.
   * Write attrs via `tr.setDocAttribute(name, value)`.
   *
   * Example:
   *   addDocAttrs() { return { headerFooter: { default: null } }; }
   */
  addDocAttrs?(this: Phase1Context<Options>): Record<string, AttributeSpec>;

  // ── Phase 2: Behaviour ──────────────────────────────────────────────────────
  // Called with `this = ExtensionContext` — the built schema is available.

  /** Return ProseMirror plugins (input rules, decorations, state fields, etc.) */
  addProseMirrorPlugins?(this: ExtensionContext<Options>): Plugin[];

  /**
   * Return an initial ProseMirror document to seed EditorState.create().
   * Called after addProseMirrorPlugins — use this when a plugin (e.g. ySyncPlugin)
   * needs the EditorState to start with a specific doc instance that matches
   * its internal mapping (e.g. the doc returned by initProseMirrorDoc).
   * Return null to use the schema default.
   */
  addInitialDoc?(this: ExtensionContext<Options>): Node | null;

  /**
   * Keymap bindings. Keys are platform-agnostic shortcuts: "Mod-b", "Shift-Enter".
   * "Mod" resolves to Cmd on Mac, Ctrl elsewhere (handled by prosemirror-keymap).
   */
  addKeymap?(this: ExtensionContext<Options>): Record<string, Command>;

  /**
   * Named commands exposed on editor.commands.
   * Commands are functions that return a ProseMirror Command (state, dispatch, view?).
   *
   * @example
   * addCommands() {
   *   return {
   *     toggleBold: () => toggleMark(this.schema.marks.bold),
   *   };
   * }
   */
  addCommands?(this: ExtensionContext<Options>): Record<string, (...args: unknown[]) => Command>;

  // ── Phase 3: Layout ─────────────────────────────────────────────────────────
  // Block extensions only. Inline extensions use addMarkDecorators instead.

  /**
   * Map of node type name → BlockStrategy.
   * Each entry is registered in BlockRegistry so PageRenderer can dispatch
   * rendering to the correct strategy per block type.
   *
   * Simple extensions (one block type) return `{ [this.name]: strategy }`.
   * Aggregating extensions like StarterKit merge strategies from inner extensions.
   *
   * @example
   * addLayoutHandlers() {
   *   return { paragraph: TextBlockStrategy };
   * }
   */
  addLayoutHandlers?(this: Phase1Context<Options>): Record<string, BlockStrategy>;

  /**
   * Map of node type name → InlineStrategy.
   * Each entry is registered in InlineRegistry so TextBlockStrategy can dispatch
   * rendering of inline object spans (images, widgets) to the correct strategy.
   *
   * @example
   * addInlineHandlers() {
   *   return { image: createInlineImageStrategy() };
   * }
   */
  addInlineHandlers?(this: Phase1Context<Options>): Record<string, InlineStrategy>;

  /**
   * Block styles contributed by this extension.
   * Merged into the FontConfig used by layoutDocument.
   * Keys are node type names or compound keys like "heading_1".
   */
  addBlockStyles?(this: Phase1Context<Options>): Record<string, BlockStyle>;

  // ── Phase 4: Render ─────────────────────────────────────────────────────────

  /**
   * Visual decorators for mark types.
   * Keys are mark type names (e.g. "highlight", "strikethrough").
   *
   * Bold and italic don't need decorators — they're handled by StyleResolver
   * changing the font string. Use decorators for visual-only effects.
   */
  addMarkDecorators?(this: Phase1Context<Options>): Record<string, MarkDecorator>;

  /**
   * Declares how this extension's marks modify the font string.
   * Keys are mark type names, values are FontModifier functions.
   *
   * Only implement for mark extensions that affect text metrics (bold, italic,
   * font size, font family). Visual-only effects use addMarkDecorators instead.
   */
  addFontModifiers?(this: Phase1Context<Options>): Map<string, FontModifier>;

  /**
   * Toolbar buttons this extension contributes.
   * Data only — the UI layer renders them however it wants.
   */
  addToolbarItems?(this: Phase1Context<Options>): ToolbarItemSpec[];

  /**
   * Custom markdown block rules for PasteTransformer.
   * Tried before built-in heading/bullet/ordered rules on each pasted line.
   * Phase 1 — no schema needed at definition time; schema is passed to createNode at runtime.
   */
  addMarkdownRules?(this: Phase1Context<Options>): MarkdownBlockRule[];

  /**
   * ProseMirror input rules (auto-format while typing).
   * Collected by ExtensionManager and wrapped in a single inputRules() plugin.
   * Phase 2 — schema is available via this.schema.
   *
   * @example
   * // Heading: "# " at start of block → heading level 1
   * textblockTypeInputRule(/^#\s$/, this.schema.nodes.heading, { level: 1 })
   */
  addInputRules?(this: ExtensionContext<Options>): InputRule[];

  /**
   * Token handlers for prosemirror-markdown's MarkdownParser.
   * Maps markdown-it token names to ProseMirror node/mark names.
   * Called during paste to parse incoming markdown text.
   * Phase 1 — no schema needed; schema is used at parse time.
   */
  addMarkdownParserTokens?(this: Phase1Context<Options>): Record<string, MarkdownParserTokenSpec>;

  /**
   * Serializer rules for prosemirror-markdown's MarkdownSerializer.
   * Used by exportToMarkdown() to convert this extension's nodes/marks to markdown text.
   * Phase 1 — no schema needed.
   */
  addMarkdownSerializerRules?(this: Phase1Context<Options>): MarkdownSerializerRules;

  /**
   * Runtime lifecycle hook — called once after the Editor is fully initialised
   * (EditorState created, initial layout done, all plugins active).
   *
   * Use this for setup that requires the live editor instance: connecting
   * collaboration providers, registering overlay render handlers, subscribing
   * to state changes, initialising plugin views without a ProseMirror EditorView.
   *
   * Return a cleanup function that will be called when editor.destroy() runs.
   *
   * @example
   * onEditorReady(editor) {
   *   const unsub = editor.subscribe(() => broadcastCursor());
   *   const unreg = editor.addOverlayRenderHandler(drawRemoteCursors);
   *   return () => { unsub(); unreg(); };
   * }
   */
  onEditorReady?(this: Phase1Context<Options>, editor: IBaseEditor): (() => void) | void;

  /**
   * Editor-level input handlers — for keys that need access to the editor
   * instance rather than just the ProseMirror state.
   *
   * Use this for navigation (arrow keys, Home/End) where visual line positions
   * from CharacterMap are needed. For document mutations, use addKeymap() instead.
   *
   * Return true to indicate the key was handled (prevents default + stops propagation).
   */
  addInputHandlers?(this: Phase1Context<Options>): Record<string, InputHandler>;
}

// ── Resolved extension (internal — produced by Extension.resolve()) ───────────

export interface ResolvedExtension {
  name: string;
  nodes: Record<string, NodeSpec>;
  marks: Record<string, MarkSpec>;
  /**
   * Doc-level attribute contributions. See `ExtensionConfig.addDocAttrs`.
   */
  docAttrs: Record<string, AttributeSpec>;
  plugins: Plugin[];
  keymap: Record<string, Command>;
  commands: Record<string, (...args: unknown[]) => Command>;
  /** Map of node type name → BlockStrategy, contributed by this extension. */
  layoutHandlers: Record<string, BlockStrategy>;
  /** Map of node type name → InlineStrategy, contributed by this extension. */
  inlineHandlers: Record<string, InlineStrategy>;
  /** Block styles contributed by this extension (merged into FontConfig). */
  blockStyles: Record<string, BlockStyle>;
  markDecorators: Map<string, MarkDecorator>;
  fontModifiers: Map<string, FontModifier>;
  toolbarItems: ToolbarItemSpec[];
  inputHandlers: Record<string, InputHandler>;
  markdownRules: MarkdownBlockRule[];
  inputRules: InputRule[];
  markdownParserTokens: Record<string, MarkdownParserTokenSpec>;
  markdownSerializerRules: MarkdownSerializerRules;
  /** Runtime lifecycle callback — undefined when extension has no onEditorReady. */
  editorReadyCallback?: (editor: IBaseEditor) => (() => void) | void;
  /** Optional initial ProseMirror document — provided by addInitialDoc(). */
  initialDoc?: Node;
}
