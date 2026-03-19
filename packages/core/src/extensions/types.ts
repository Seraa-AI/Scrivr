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

import type { NodeSpec, MarkSpec, Schema } from "prosemirror-model";
import type { Command, Plugin } from "prosemirror-state";
import type { BlockStrategy } from "../layout/BlockRegistry";

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
  decoratePost?(ctx: CanvasRenderingContext2D, rect: SpanRect): void;
}

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
   * Layout strategy for a block node type.
   * Registered in BlockRegistry under this extension's name.
   *
   * Only implement this for block node extensions (paragraph, image, etc.).
   * The node type name registered must match this extension's `name`.
   */
  addLayoutHandler?(this: Phase1Context<Options>): BlockStrategy;

  // ── Phase 4: Render ─────────────────────────────────────────────────────────

  /**
   * Visual decorators for mark types.
   * Keys are mark type names (e.g. "highlight", "strikethrough").
   *
   * Bold and italic don't need decorators — they're handled by StyleResolver
   * changing the font string. Use decorators for visual-only effects.
   */
  addMarkDecorators?(this: Phase1Context<Options>): Record<string, MarkDecorator>;
}

// ── Resolved extension (internal — produced by Extension.resolve()) ───────────

export interface ResolvedExtension {
  name: string;
  nodes: Record<string, NodeSpec>;
  marks: Record<string, MarkSpec>;
  plugins: Plugin[];
  keymap: Record<string, Command>;
  commands: Record<string, (...args: unknown[]) => Command>;
  layoutHandler: BlockStrategy | null;
  markDecorators: Map<string, MarkDecorator>;
}
