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

import type { NodeSpec, MarkSpec, Schema, Node } from "prosemirror-model";
import type { Command, Plugin } from "prosemirror-state";
import type { InputRule } from "prosemirror-inputrules";
import type { BlockStrategy } from "../layout/BlockRegistry";
import type { BlockStyle } from "../layout/FontConfig";
import type { ParsedFont } from "../layout/StyleResolver";

/**
 * Declares how a mark extension modifies the CSS font string.
 * Called by resolveFont for each mark on a text node.
 */
export type FontModifier = (parsed: ParsedFont, attrs: Record<string, unknown>) => void;

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

  // ── Phase 2: Behaviour ──────────────────────────────────────────────────────
  // Called with `this = ExtensionContext` — the built schema is available.

  /** Return ProseMirror plugins (input rules, decorations, state fields, etc.) */
  addProseMirrorPlugins?(this: ExtensionContext<Options>): Plugin[];

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
  plugins: Plugin[];
  keymap: Record<string, Command>;
  commands: Record<string, (...args: unknown[]) => Command>;
  /** Map of node type name → BlockStrategy, contributed by this extension. */
  layoutHandlers: Record<string, BlockStrategy>;
  /** Block styles contributed by this extension (merged into FontConfig). */
  blockStyles: Record<string, BlockStyle>;
  markDecorators: Map<string, MarkDecorator>;
  fontModifiers: Map<string, FontModifier>;
  toolbarItems: ToolbarItemSpec[];
  inputHandlers: Record<string, InputHandler>;
  markdownRules: MarkdownBlockRule[];
  inputRules: InputRule[];
}
