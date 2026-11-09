import type { LayoutBlock } from "../layout/BlockLayout";
import type { BlockRenderContext } from "../layout/BlockRegistry";
import type { CharacterMap } from "../layout/CharacterMap";
import { markerAnchorOf } from "../layout/markers";
import { drawBlock } from "./PageRenderer";

/**
 * Paints one laid-out block: through the strategy registered for its
 * `blockType`, or the default text painter, then its marker on top — after
 * the block, so a painter's background cannot cover it. The marker is drawn
 * by the painter registered under its key; none registered draws nothing.
 *
 * Every surface that paints blocks goes through here — pages, pageless tiles,
 * the blocks of a table cell and header and footer bands — so a marker is
 * drawn wherever its block is. Returns the next line index, as a strategy does.
 */
export function paintBlock(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
  const { ctx, blockRegistry, measurer, pageNumber, lineIndexOffset, theme, markDecorators, inlineRegistry, fontResolutions } =
    renderCtx;
  const strategy = blockRegistry?.get(block.blockType);
  const next = strategy
    ? strategy.render(block, renderCtx, map)
    : drawBlock(ctx, block, measurer, map, pageNumber, lineIndexOffset, theme, markDecorators, inlineRegistry, fontResolutions);
  const marker = markerAnchorOf(block);
  if (marker) {
    ctx.save();
    blockRegistry?.markerPainter(marker.painter)?.canvas(ctx, marker, theme);
    ctx.restore();
  }
  return next;
}
