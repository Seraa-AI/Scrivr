import type { CharacterMap } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";
import { TextBlockStrategy } from "./TextBlockStrategy";

/**
 * ListItemStrategy — renders a list item block.
 *
 * Draws the bullet character or ordered number at listMarkerX,
 * then delegates all text rendering to TextBlockStrategy.
 */
export const ListItemStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx } = renderCtx;

    // Draw the marker (bullet or number) aligned to the first line's baseline.
    if (block.listMarker !== undefined && block.listMarkerX !== undefined) {
      const firstLine = block.lines[0];
      if (firstLine) {
        const baseline = block.y + firstLine.ascent;
        const firstSpan = firstLine.spans[0];
        ctx.font = (firstSpan?.kind === "text" ? firstSpan.font : undefined) ?? "14px Georgia, serif";
        ctx.fillStyle = "#1e293b";
        ctx.textAlign = "right";
        ctx.fillText(block.listMarker, block.listMarkerX, baseline);
        ctx.textAlign = "left";
      }
    }

    return TextBlockStrategy.render(block, renderCtx, map);
  },
};
