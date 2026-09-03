import type { Node, NodeType } from "prosemirror-model";
import type { CharacterMap } from "./CharacterMap";
import type { TextMeasurerLike } from "./TextMeasurer";
import type { LayoutBlock } from "./BlockLayout";
import type { MarkDecorator } from "../extensions/types";
import type { ResolvedTheme } from "../model/theme";

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

  /**
   * Optional dynamic measurement. Called during layout to compute the actual
   * width and height for this inline object. When present, overrides the
   * node's width/height attrs. This lets tokens (page number, date) size
   * themselves based on the current font instead of using fixed placeholders.
   */
  measure?(node: Node, font: string, measurer: TextMeasurerLike): { width: number; height: number };

  render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    node: Node,
    theme: ResolvedTheme,
  ): void;
}

// ── Inline render context ─────────────────────────────────────────────────────
// (Inline strategies receive theme as their last positional arg — see render
// signature above. Block strategies receive theme via BlockRenderContext.)

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
  measurer: TextMeasurerLike;
  markDecorators?: Map<string, MarkDecorator>;
  /** Registry for block render strategies, used by composite blocks such as table rows. */
  blockRegistry?: BlockRegistry;
  /** Registry for inline objects (images, widgets) drawn inside line boxes. */
  inlineRegistry?: InlineRegistry;
  /**
   * Resolved theme — every paint site reads colors from here. Defaults if
   * the editor has no `theme` option, so existing behaviour is preserved.
   */
  theme: ResolvedTheme;
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

// ── NodeLayout ────────────────────────────────────────────────────────────────

/**
 * How a node participates in layout — declared on its node spec, independent of
 * what the node means in the document tree.
 *
 * These are two separate dimensions. A node can matter enormously to the model
 * (identity, provenance, actions, lifecycle) and have no visual existence of
 * its own; `sourcedBlock` is exactly that. Before this existed, the layout
 * walker inferred participation from the node's *name* — lists and tables
 * expanded, everything else was assumed to be a text block — so a new
 * structural node either had to be added to that list or laid out as one empty
 * line.
 *
 * - `block` — the node occupies its own box in the flow. Today its painter
 *   comes from `addLayoutHandlers()`; the strategy is expected to move onto
 *   this declaration, at which point the text-block fallback for undeclared
 *   nodes can become an error instead of a guess.
 * - `transparent` — the node contributes no box of its own. It stays in the
 *   editor tree, but its children are collected into the parent's layout flow
 *   as if the boundary weren't there.
 */
export type NodeLayout = { kind: "block" } | { kind: "transparent" };

/** Layout for a node that declares nothing — its own box, painted by strategy. */
export const DEFAULT_NODE_LAYOUT: NodeLayout = { kind: "block" };

function isNodeLayout(value: unknown): value is NodeLayout {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const { kind } = value;
  return kind === "block" || kind === "transparent";
}

/**
 * Read a node type's declared layout participation.
 *
 * Nodes that declare nothing default to `block`, which is what every built-in
 * node was implicitly relying on before the declaration existed.
 */
export function nodeLayout(type: NodeType): NodeLayout {
  const declared: unknown = type.spec["layout"];
  return isNodeLayout(declared) ? declared : DEFAULT_NODE_LAYOUT;
}
