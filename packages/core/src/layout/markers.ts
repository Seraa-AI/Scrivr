import type { FontResolutionId } from "../fonts/layoutResolver";
import { DEFAULT_FONT_SIZE_PX, parseFontSizePx } from "../fonts/activeFontSize";
import type { PdfNodeContext } from "../exports/pdf";
import type { ResolvedTheme } from "../model/theme";
import type { LayoutBlock } from "./BlockLayout";
import { isSpacerLine, type LayoutLine } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";

/** The face and size a marker is measured and drawn in. */
export interface MarkerFace {
  /** CSS font the marker is measured and drawn in. */
  font: string;
  /** In px; never 0. */
  size: number;
  /** How `font` was resolved, when it came from a run; absent for the fallback. */
  resolution?: FontResolutionId;
}

/**
 * Something a wrapper hangs before the first line of a block it wraps: a
 * list's number, a task's checkbox. Core places and carries it; the extension
 * registered under `painter` draws it.
 */
export interface BlockMarker {
  /** The key its painters are registered under through `addMarkerPainters()`. */
  painter: string;
  /**
   * The painter's own data, opaque to core. Compared by identity to reuse a
   * block's measurement, so a value made afresh each layout re-measures it.
   */
  data: unknown;
  /** How far before the text its left edge hangs. */
  hanging: number;
  /** Its width in the face of the block's first text, which pushes the first line when it reaches the text. */
  width(face: MarkerFace, measurer: TextMeasurerLike): number;
}

/** A marker as layout leaves it on its block. */
export interface LaidMarker {
  painter: string;
  data: unknown;
  /** Absolute x of its left edge, hanging before the text. */
  x: number;
  /** The face it was measured in, from the block's text; every part of a split block keeps it. */
  face?: MarkerFace;
}

/** A marker where it is drawn: its face, its left edge and the baseline it sits on. */
export interface PlacedMarker extends MarkerFace {
  painter: string;
  data: unknown;
  /** Page-local y of the baseline. */
  baseline: number;
  /** Absolute x of its left edge: the laid `x`, or past a float that moves its line. */
  x: number;
}

/**
 * Draws one kind of marker, on both surfaces, so a marker never ships on one
 * only. Registered by key through `addMarkerPainters()`.
 */
export interface MarkerPainter {
  /** Draws it on a canvas, over its block. */
  canvas(ctx: CanvasRenderingContext2D, marker: PlacedMarker, theme: ResolvedTheme): void;
  /** Draws it into a PDF through the export's draw surface, in layout pixels. */
  pdf(marker: PlacedMarker, ctx: PdfNodeContext): void;
}

const FALLBACK_MARKER_FONT = `${DEFAULT_FONT_SIZE_PX}px Arial, sans-serif`;

/**
 * A marker takes the face and size of the text it labels: the block's first
 * text run, past any image or anchor that opens it and past a line the marker
 * stands on alone — Word sizes a number from the paragraph's text, not from a
 * picture. Layout measures the marker in what this returns and records it on
 * the block's marker as `face`.
 */
export function markerFaceOf(lines: readonly LayoutLine[]): MarkerFace {
  const firstText = lines.flatMap((line) => line.spans).find((span) => span.kind === "text");
  if (firstText?.kind !== "text") return { font: FALLBACK_MARKER_FONT, size: DEFAULT_FONT_SIZE_PX };
  const parsed = parseFontSizePx(firstText.font);
  return {
    font: firstText.font,
    size: parsed !== null && parsed > 0 ? parsed : DEFAULT_FONT_SIZE_PX,
    ...(firstText.resolution !== undefined ? { resolution: firstText.resolution } : {}),
  };
}

/**
 * Where a block's marker is drawn: in the face layout measured it in, on the
 * baseline of its first line with text height — past any gap a full-width
 * float leaves above it, and past a floating image's anchor left alone on an
 * empty line. Canvas and PDF both draw from this, so they never disagree.
 * Null for a block without a marker.
 */
export function markerAnchorOf(block: LayoutBlock): PlacedMarker | null {
  const { marker } = block;
  if (!marker) return null;
  const firstWithHeight = block.lines.findIndex((line) => line.ascent > 0);
  const index = firstWithHeight >= 0 ? firstWithHeight : block.lines.findIndex((line) => !isSpacerLine(line));
  const markerLine = block.lines[index];
  if (!markerLine) return null;
  const top = block.y + block.lines.slice(0, index).reduce((sum, line) => sum + line.lineHeight, 0);
  const lineStart = markerLine.segments?.[0]?.indentFrom ?? 0;
  return {
    ...(marker.face ?? markerFaceOf(block.lines)),
    painter: marker.painter,
    data: marker.data,
    baseline: top + markerLine.ascent,
    x: lineStart > 0 ? Math.max(marker.x, block.x + lineStart) : marker.x,
  };
}
