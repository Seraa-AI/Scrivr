import type { FontResolutionId } from "../fonts/layoutResolver";
import { DEFAULT_FONT_SIZE_PX, parseFontSizePx } from "../fonts/activeFontSize";
import type { ResolvedTheme } from "../model/theme";
import { bulletBox, bulletShape, type BulletShape } from "../model/lists";
import type { LayoutBlock } from "./BlockLayout";
import { isSpacerLine, type LayoutLine } from "./LineBreaker";

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
 * a picture. Layout measures the marker in what this returns and records it on
 * the block as `listMarkerFace`.
 */
export function markerFaceOf(lines: readonly LayoutLine[]): ListMarkerFont {
  const firstText = lines.flatMap((line) => line.spans).find((span) => span.kind === "text");
  if (firstText?.kind !== "text") return { font: FALLBACK_MARKER_FONT, size: DEFAULT_FONT_SIZE_PX };
  const parsed = parseFontSizePx(firstText.font);
  return {
    font: firstText.font,
    size: parsed !== null && parsed > 0 ? parsed : DEFAULT_FONT_SIZE_PX,
    ...(firstText.resolution !== undefined ? { resolution: firstText.resolution } : {}),
  };
}

/** A block's marker as it is drawn: its face, and the baseline it sits on. */
export interface ListMarker extends ListMarkerFont {
  /** Page-local y of the baseline the marker is drawn on. */
  baseline: number;
}

/**
 * How a block's list marker is drawn: in the face layout measured it in, on
 * the baseline of its first line with text height — past any gap a
 * full-width float leaves above it, and past a floating image's anchor left
 * alone on an empty line. Canvas and PDF both draw from this, so they never
 * disagree. Null for a block without a marker.
 */
export function listMarkerOf(block: LayoutBlock): ListMarker | null {
  if (block.listMarker === undefined || block.listMarkerX === undefined) return null;
  const firstWithHeight = block.lines.findIndex((line) => line.ascent > 0);
  const index = firstWithHeight >= 0 ? firstWithHeight : block.lines.findIndex((line) => !isSpacerLine(line));
  const numberLine = block.lines[index];
  const top = block.y + block.lines.slice(0, index).reduce((sum, line) => sum + line.lineHeight, 0);
  if (!numberLine) return null;
  return { ...(block.listMarkerFace ?? markerFaceOf(block.lines)), baseline: top + numberLine.ascent };
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
  const marker = listMarkerOf(block);
  if (!marker || block.listMarker === undefined || block.listMarkerX === undefined) return;
  const { font, size, baseline } = marker;
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
