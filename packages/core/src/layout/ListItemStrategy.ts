import type { CharacterMap } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";
import { TextBlockStrategy } from "./TextBlockStrategy";
import { bulletBox, bulletShape, listMarkerFont, type BulletShape } from "../model/lists";

type BulletPainter = (ctx: CanvasRenderingContext2D, left: number, centerY: number, fontSize: number) => void;

const BULLET_PAINTERS: Record<BulletShape, BulletPainter> = {
  disc: (ctx, left, centerY, fontSize) => {
    const radius = bulletBox(fontSize).size / 2;
    ctx.beginPath();
    ctx.arc(left + radius, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  },
  circle: (ctx, left, centerY, fontSize) => {
    const { size, stroke } = bulletBox(fontSize);
    const radius = size / 2;
    ctx.beginPath();
    ctx.lineWidth = stroke;
    ctx.arc(left + radius, centerY, radius - stroke / 2, 0, Math.PI * 2);
    ctx.stroke();
  },
  square: (ctx, left, centerY, fontSize) => {
    const { size } = bulletBox(fontSize);
    ctx.fillRect(left, centerY - size / 2, size, size);
  },
};

/**
 * ListItemStrategy — renders a list item block.
 *
 * Draws the marker with its left edge at listMarkerX, on the first line's
 * baseline — a bullet as a shape, a number as text — then delegates all text
 * rendering to TextBlockStrategy.
 */
export const ListItemStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, theme } = renderCtx;
    const firstLine = block.lines[0];

    if (block.listMarker !== undefined && block.listMarkerX !== undefined && firstLine) {
      const baseline = block.y + firstLine.ascent;
      const { font, size } = listMarkerFont(firstLine);
      ctx.fillStyle = theme.listMarker;
      ctx.strokeStyle = theme.listMarker;
      const shape = bulletShape(block.listMarker);
      if (shape) {
        BULLET_PAINTERS[shape](ctx, block.listMarkerX, baseline - bulletBox(size).centerAboveBaseline, size);
      } else {
        ctx.font = font;
        ctx.textAlign = "left";
        ctx.fillText(block.listMarker, block.listMarkerX, baseline);
      }
    }

    return TextBlockStrategy.render(block, renderCtx, map);
  },
};
