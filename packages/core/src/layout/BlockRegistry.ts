import type { Node } from "prosemirror-model";
import type { CharacterMap } from "./CharacterMap";
import type { TextMeasurer } from "./TextMeasurer";
import type { LayoutBlock } from "./BlockLayout";
import type { MarkDecorator } from "../extensions/types";

// ── InlineStrategy ────────────────────────────────────────────────────────────

/**
 * Render contract for inline objects (images, widgets) that live inside a
 * paragraph's line box instead of being full-width block nodes.
 *
 * Called by TextBlockStrategy for each LayoutSpan of kind "object".
 */
export interface InlineStrategy {
  /**
   * Default vertical alignment for this inline object type within a line box.
   * The node's own `verticalAlign` attr takes precedence at runtime — this is
   * the fallback used when no attr is present (e.g. nodes created without it).
   *
   * "baseline" (default) matches Google Docs: object bottom on text baseline.
   */
  verticalAlign?: "baseline" | "middle" | "top";

  render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    node: Node,
  ): void;
}

// ── InlineRegistry ────────────────────────────────────────────────────────────

/**
 * Registry mapping ProseMirror node type names to InlineStrategies.
 *
 * Built by ExtensionManager from all extensions that implement addInlineHandlers().
 * Consumed by TextBlockStrategy — for each inline-object span, it looks up the
 * strategy and calls render().
 */
export class InlineRegistry {
  private readonly strategies = new Map<string, InlineStrategy>();

  register(nodeTypeName: string, strategy: InlineStrategy): this {
    this.strategies.set(nodeTypeName, strategy);
    return this;
  }

  get(nodeTypeName: string): InlineStrategy | undefined {
    return this.strategies.get(nodeTypeName);
  }

  has(nodeTypeName: string): boolean {
    return this.strategies.has(nodeTypeName);
  }
}

// ── BlockStrategy ─────────────────────────────────────────────────────────────

/**
 * Context passed to BlockStrategy.render().
 * Contains everything a strategy needs to draw its block and register glyphs.
 */
export interface BlockRenderContext {
  ctx: CanvasRenderingContext2D;
  /** 1-based page number — used when registering glyphs into CharacterMap */
  pageNumber: number;
  /**
   * Page-global line count before this block.
   * Each strategy must use globalLineIndex = lineIndexOffset + localLineIndex
   * when registering lines and glyphs, so click hit-testing works across blocks.
   */
  lineIndexOffset: number;
  dpr: number;
  measurer: TextMeasurer;
  markDecorators?: Map<string, MarkDecorator>;
  /** Registry for inline objects (images, widgets) drawn inside line boxes. */
  inlineRegistry?: InlineRegistry;
}

/**
 * BlockStrategy — the render contract every block type must implement.
 *
 * render() draws the block onto the canvas and populates the CharacterMap
 * with glyph positions for cursor / click hit-testing.
 *
 * Returns the updated lineIndexOffset (lineIndexOffset + block.lines.length)
 * so the caller can pass it to the next block.
 *
 * Future extensions implement this for code blocks, tables, etc.
 */
export interface BlockStrategy {
  render(
    block: LayoutBlock,
    renderCtx: BlockRenderContext,
    map: CharacterMap,
  ): number;
}

// ── BlockRegistry ─────────────────────────────────────────────────────────────

/**
 * Registry mapping ProseMirror node type names to BlockStrategies.
 *
 * Built by ExtensionManager from all extensions that implement addLayoutHandlers().
 * Consumed by PageRenderer — for each block, PageRenderer calls
 * registry.get(block.blockType)?.render(block, ctx, map).
 */
export class BlockRegistry {
  private readonly strategies = new Map<string, BlockStrategy>();

  register(nodeTypeName: string, strategy: BlockStrategy): this {
    this.strategies.set(nodeTypeName, strategy);
    return this;
  }

  get(nodeTypeName: string): BlockStrategy | undefined {
    return this.strategies.get(nodeTypeName);
  }

  has(nodeTypeName: string): boolean {
    return this.strategies.has(nodeTypeName);
  }
}
