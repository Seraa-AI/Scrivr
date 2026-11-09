import type { LayoutBlock } from "../layout/BlockLayout";
import type { BlockRenderContext } from "../layout/BlockRegistry";
import type { CharacterMap } from "../layout/CharacterMap";
import { drawListMarker } from "../layout/listMarkers";
import { drawBlock } from "./PageRenderer";

/**
 * Paints one laid-out block: through the strategy registered for its
 * `blockType`, or the default text painter, then its list marker on top —
 * after the block, so a painter's background cannot cover the number.
 *
 * Every surface that paints blocks goes through here — pages, pageless tiles,
 * the blocks of a table cell (a cell holds lists like the body does) and
 * header and footer bands — so a list's number is drawn wherever its block
 * is. Returns the next line index, as a strategy does.
 */
export function paintBlock(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
  const { ctx, blockRegistry, measurer, pageNumber, lineIndexOffset, theme, markDecorators, inlineRegistry, fontResolutions } =
    renderCtx;
  const strategy = blockRegistry?.get(block.blockType);
  const next = strategy
    ? strategy.render(block, renderCtx, map)
    : drawBlock(ctx, block, measurer, map, pageNumber, lineIndexOffset, theme, markDecorators, inlineRegistry, fontResolutions);
  drawListMarker(ctx, block, theme);
  return next;
}
