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
 * A composite unit's strategy paints only its decoration (a table row's grid);
 * what its regions hold is painted here, block by block, so it draws as it
 * does anywhere else.
 *
 * Every surface that paints blocks goes through here — pages, pageless tiles,
 * the blocks of a composite's regions and header and footer bands — so a
 * marker is drawn wherever its block is. Returns the next line index, as a
 * strategy does.
 */
export function paintBlock(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
  const { ctx, blockRegistry, measurer, pageNumber, lineIndexOffset, theme, markDecorators, inlineRegistry, fontResolutions } =
    renderCtx;
  const strategy = blockRegistry?.get(block.blockType);
  if (block.kind === "composite") {
    strategy?.render(block, renderCtx, map);
    return paintRegions(block, renderCtx, map);
  }
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

/** Paints what a composite unit's regions hold, each block at its absolute y. */
function paintRegions(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
  let lineIndexOffset = renderCtx.lineIndexOffset;
  for (const region of block.regions ?? []) {
    for (const child of region.blocks) {
      lineIndexOffset = paintBlock({ ...child, y: block.y + child.y }, { ...renderCtx, lineIndexOffset }, map);
    }
  }
  return lineIndexOffset;
}
