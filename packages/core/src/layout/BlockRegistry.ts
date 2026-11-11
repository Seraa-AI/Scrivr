import type { Node, NodeType } from "prosemirror-model";
import type { FontResolutionId } from "../fonts/layoutResolver";
import type { FontResolution } from "../fonts/types";
import type { CharacterMap } from "./CharacterMap";
import type { TextMeasurerLike } from "./TextMeasurer";
import type { LayoutBlock } from "./BlockLayout";
import type { MarkDecorator } from "../extensions/types";
import type { ResolvedTheme } from "../model/theme";
import type { BlockMarker, MarkerPainter } from "./markers";

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
  /**
   * Every face this layout measured against, so a run can be painted with what
   * its chosen face does not supply. Absent when there is no font provider.
   */
  fontResolutions?: ReadonlyMap<FontResolutionId, FontResolution>;
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
 * How blocks are painted: BlockStrategies by node type name, and marker
 * painters by the key a `BlockMarker` names.
 *
 * Built by ExtensionManager from addLayoutHandlers() and addMarkerPainters().
 * Consumed through `paintBlock`, which every surface calls for each block: it
 * looks the block's strategy up here by `blockType` and then draws the block's
 * marker. A new surface paints with `paintBlock` rather than calling a
 * strategy itself, or its markers are lost.
 */
export class BlockRegistry {
  private readonly strategies = new Map<string, BlockStrategy>();
  private readonly markerPainters = new Map<string, MarkerPainter>();

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

  registerMarkerPainter(key: string, painter: MarkerPainter): this {
    this.markerPainters.set(key, painter);
    return this;
  }

  markerPainter(key: string): MarkerPainter | undefined {
    return this.markerPainters.get(key);
  }
}

// ── NodeLayout ────────────────────────────────────────────────────────────────

/** Opaque to core: whatever a wrapper's extension hands down to what it wraps. */
export type WrapScope = Readonly<Record<string, unknown>>;

/** What a wrapper does to one block it wraps. */
export interface WrapPlacement {
  /** How much further in the block sits; the indents of every wrapper around it add up. */
  indent: number;
  /** Hung before the block's first line. The innermost wrapper that hangs one wins. */
  marker?: BlockMarker;
  /** The block style it is spaced by, in place of its own. The innermost wrapper that names one wins. */
  styleKey?: string;
}

/** How a transparent node shapes the blocks laid out in its place. */
export interface WrapperLayout {
  /**
   * What this wrapper hands down, from what it received. Spread `outer` into
   * the result so wrappers inside still see what wrappers outside handed down.
   */
  enter(node: Node, outer: WrapScope): WrapScope;
  /**
   * Called for each block laid out inside this wrapper, at any depth and in
   * order; `index` counts them from 0, so 0 is the wrapper's first block.
   */
  place(block: Node, index: number, scope: WrapScope): WrapPlacement;
}

/**
 * How a node participates in layout — declared on its node spec, independent of
 * what the node means in the document tree.
 *
 * These are two separate dimensions. A node can matter enormously to the model
 * (identity, provenance, actions, lifecycle) and have no visual existence of
 * its own; `sourcedBlock` is exactly that. Before this existed, the layout
 * walker inferred participation from the node's *name*, so a new structural
 * node either had to be special-cased there or laid out as one empty line.
 *
 * - `block` — the node occupies its own box in the flow. Today its painter
 *   comes from `addLayoutHandlers()`; the strategy is expected to move onto
 *   this declaration, at which point the text-block fallback for undeclared
 *   nodes can become an error instead of a guess. A node whose content is
 *   blocks keeps its box only when it declares `{ kind: "block" }` explicitly.
 * - `transparent` — the node contributes no box of its own. It stays in the
 *   editor tree, but its children are collected into the parent's layout flow
 *   as if the boundary weren't there. With `wrap`, it shapes them: indents
 *   them, restyles them, or hangs a marker before them.
 * - `break` — the node has no box: a block that breaks the page starts the
 *   next block on a new page, an inline node that breaks the line ends its
 *   line. Only a leaf can break; a node that holds content ignores it.
 * - `composite` — the node is laid out as units, each of side-by-side
 *   regions (see `CompositeLayout`): a table, its rows, their cells.
 */
export type NodeLayout =
  | { kind: "block" }
  | { kind: "transparent"; wrap?: WrapperLayout }
  | { kind: "break"; breaks: BreakKind }
  | { kind: "composite"; composite: CompositeLayout };

/** One unit of a composite node, the piece pagination places whole: a table's row. */
export interface CompositeUnit {
  node: Node;
  /** Document position of the unit's node. */
  pos: number;
  /** The extension's own, for its regions and painter: a table's column grid. */
  data: unknown;
}

/** Space kept clear inside a region's edges: a cell's padding. */
export interface RegionInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where one region of a unit sits; the engine lays out what its node holds there. */
export interface RegionPlacement {
  /** The region's node: its child blocks are laid out in it. */
  node: Node;
  pos: number;
  /** Left edge, relative to the unit's left. */
  x: number;
  width: number;
  inset: RegionInset;
  /** The extension's own, for its painter: a cell's background or merge. */
  data?: unknown;
}

/**
 * How a composite node is laid out: as units placed one at a time, each made
 * of side-by-side regions. The extension says where regions sit; the engine
 * lays out what each holds with the walk the page body uses, sizes the unit
 * to its tallest region and stretches every region to that height.
 */
export interface CompositeLayout {
  /** The units, in order, for a composite node at `pos`. */
  units(node: Node, pos: number): CompositeUnit[];
  /** The regions of a unit laid out `width` wide. */
  regions(unit: CompositeUnit, width: number): RegionPlacement[];
}

function isCompositeLayout(value: unknown): value is CompositeLayout {
  return typeof value === "object" && value !== null
    && "units" in value && typeof value.units === "function"
    && "regions" in value && typeof value.regions === "function";
}

/** What a `break` node ends: the page its block is on, or the line it sits in. */
export type BreakKind = "page" | "line";

/**
 * Layout for a node that declares nothing and holds inline content or nothing:
 * its own box, painted by strategy. An undeclared node that holds blocks is
 * `transparent` instead (see `nodeLayout`).
 */
export const DEFAULT_NODE_LAYOUT: NodeLayout = { kind: "block" };

const TRANSPARENT: NodeLayout = { kind: "transparent" };

function isWrapperLayout(value: unknown): value is WrapperLayout {
  return typeof value === "object" && value !== null
    && "enter" in value && typeof value.enter === "function"
    && "place" in value && typeof value.place === "function";
}

/** What each kind of declaration needs beside its `kind` to be whole. */
const NODE_LAYOUT_CHECKS: Record<NodeLayout["kind"], (value: object) => boolean> = {
  block: () => true,
  transparent: (value) => !("wrap" in value) || value.wrap === undefined || isWrapperLayout(value.wrap),
  break: (value) => "breaks" in value && (value.breaks === "page" || value.breaks === "line"),
  composite: (value) => "composite" in value && isCompositeLayout(value.composite),
};

function isNodeLayoutKind(kind: unknown): kind is NodeLayout["kind"] {
  return typeof kind === "string" && Object.hasOwn(NODE_LAYOUT_CHECKS, kind);
}

function isNodeLayout(value: unknown): value is NodeLayout {
  return typeof value === "object" && value !== null && "kind" in value
    && isNodeLayoutKind(value.kind) && NODE_LAYOUT_CHECKS[value.kind](value);
}

/**
 * How a node type takes part in layout: what its spec declares, or the
 * default for its content. A node that declares nothing and holds blocks has
 * no lines of its own, so its blocks are laid out in its place
 * (`transparent`); any other undeclared node takes its own box
 * (`DEFAULT_NODE_LAYOUT`), which is what every built-in text and leaf node
 * relies on.
 */
export function nodeLayout(type: NodeType): NodeLayout {
  const declared: unknown = type.spec["layout"];
  // A break has no content to lay out, so a node that holds some ignores it.
  if (isNodeLayout(declared) && (declared.kind !== "break" || type.isLeaf)) return declared;
  return !type.isLeaf && !type.inlineContent ? TRANSPARENT : DEFAULT_NODE_LAYOUT;
}

/** What a node type breaks, when its layout declares it a break. */
export function breakOf(type: NodeType): BreakKind | null {
  const layout = nodeLayout(type);
  return layout.kind === "break" ? layout.breaks : null;
}
