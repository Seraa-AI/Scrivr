import type { FontResolutionId } from "../fonts/layoutResolver";
import { DEFAULT_FONT_SIZE_PX, parseFontSizePx } from "../fonts/activeFontSize";
import type { ResolvedTheme } from "../model/theme";
import { bulletBox, bulletShape, type BulletShape } from "../model/lists";
import type { LayoutBlock } from "./BlockLayout";
import type { LayoutLine } from "./LineBreaker";

/** The face and size a marker is drawn in. */
export interface ListMarkerFont {
  /** CSS font the marker is measured and drawn in. */
  font: string;
  /** In px; never 0. */
  size: number;
  /** How `font` was resolved, when it came from a run; absent for the fallback. */
  resolution?: FontResolutionId;
}

const FALLBACK_MARKER_FONT = `${DEFAULT_FONT_SIZE_PX}px Arial, sans-serif`;

/**
 * A marker takes the face and size of the text it labels: the item's first
 * text run, past any image or anchor that opens it and past a line the number
 * stands on alone — Word sizes the number from the paragraph's text, not from
 * a picture. Layout measures the marker, and canvas and PDF draw it, in what
 * this returns, so all three use one face.
 */
export function listMarkerFont(lines: readonly LayoutLine[]): ListMarkerFont {
  const firstText = lines.flatMap((line) => line.spans).find((span) => span.kind === "text");
  if (firstText?.kind !== "text") return { font: FALLBACK_MARKER_FONT, size: DEFAULT_FONT_SIZE_PX };
  const parsed = parseFontSizePx(firstText.font);
  return {
    font: firstText.font,
    size: parsed !== null && parsed > 0 ? parsed : DEFAULT_FONT_SIZE_PX,
    ...(firstText.resolution !== undefined ? { resolution: firstText.resolution } : {}),
  };
}

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
 * Draws a block's list marker, with its left edge at `listMarkerX` on the
 * first line's baseline: a bullet as a shape, a number as text. Whatever
 * painter draws the block, the marker is drawn the same way.
 */
export function drawListMarker(ctx: CanvasRenderingContext2D, block: LayoutBlock, theme: ResolvedTheme): void {
  const firstLine = block.lines[0];
  if (block.listMarker === undefined || block.listMarkerX === undefined || !firstLine) return;
  const baseline = block.y + firstLine.ascent;
  const { font, size } = listMarkerFont(block.lines);
  ctx.save();
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
  ctx.restore();
}
