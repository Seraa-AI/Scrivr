import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { TextMeasurer } from "./TextMeasurer";
import type { PageConfig } from "./PageLayout";
import type { CharacterMap } from "./CharacterMap";

// ── BlockStrategy ─────────────────────────────────────────────────────────────

export interface BlockMeasurement {
  width: number;
  height: number;
  spaceBefore: number;
  spaceAfter: number;
}

export interface MeasureOptions {
  availableWidth: number;
  measurer: TextMeasurer;
  pageConfig: PageConfig;
}

export interface BlockRenderContext {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

/**
 * BlockStrategy — the two-pass contract every block type must implement.
 *
 * Measure pass: PageLayout calls measure() for every block before assigning
 * any block to a page. No CharacterMap access here — positions aren't final yet.
 *
 * Render pass: PageRenderer calls render() once positions are committed.
 * This is where CharacterMap entries are populated for hit-testing.
 */
export interface BlockStrategy {
  measure(node: ProseMirrorNode, options: MeasureOptions): BlockMeasurement;
  render(
    node: ProseMirrorNode,
    layout: BlockMeasurement & { x: number; y: number },
    ctx: BlockRenderContext,
    map?: CharacterMap,
  ): void;
}

// ── BlockRegistry ─────────────────────────────────────────────────────────────

/**
 * Registry mapping ProseMirror node type names to BlockStrategies.
 *
 * Built by ExtensionManager from all extensions that implement addLayoutHandler().
 * Consumed by PageLayout (measure pass) and PageRenderer (render pass).
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
