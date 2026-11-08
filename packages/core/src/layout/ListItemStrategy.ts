import type { CharacterMap } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";
import type { LayoutLine } from "./LineBreaker";
import { TextBlockStrategy } from "./TextBlockStrategy";
import { bulletBox, bulletShape, type BulletShape } from "../model/lists";
import { parseFontSizePx } from "../fonts/activeFontSize";

const FALLBACK_MARKER_FONT = "14px Arial, sans-serif";

/** A marker takes the face and size of the text it labels: its line's first run. */
export function markerFont(firstLine: LayoutLine | undefined): string {
  const firstSpan = firstLine?.spans[0];
  return firstSpan?.kind === "text" ? firstSpan.font : FALLBACK_MARKER_FONT;
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  shape: BulletShape,
  left: number,
  baseline: number,
  fontSize: number,
): void {
  const { size, centerAboveBaseline, stroke } = bulletBox(fontSize);
  const radius = size / 2;
  const cx = left + radius;
  const cy = baseline - centerAboveBaseline;
  ctx.beginPath();
  if (shape === "square") {
    ctx.fillRect(left, cy - radius, size, size);
    return;
  }
  if (shape === "circle") {
    ctx.lineWidth = stroke;
    ctx.arc(cx, cy, radius - stroke / 2, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

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
      const font = markerFont(firstLine);
      ctx.fillStyle = theme.listMarker;
      ctx.strokeStyle = theme.listMarker;
      const shape = bulletShape(block.listMarker);
      if (shape) {
        drawBullet(ctx, shape, block.listMarkerX, baseline, parseFontSizePx(font) ?? 0);
      } else {
        ctx.font = font;
        ctx.textAlign = "left";
        ctx.fillText(block.listMarker, block.listMarkerX, baseline);
      }
    }

    return TextBlockStrategy.render(block, renderCtx, map);
  },
};
