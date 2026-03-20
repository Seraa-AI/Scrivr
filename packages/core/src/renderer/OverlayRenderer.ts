import type { CoordsResult, GlyphEntry } from "../layout/CharacterMap";

/**
 * Clears the overlay canvas back to fully transparent.
 *
 * Unlike clearCanvas (which fills with white), this uses clearRect so the
 * overlay stays transparent between the content canvas and the user's eyes.
 *
 * Mirrors the resetTransform + re-scale pattern from clearCanvas so callers
 * can treat content and overlay canvases the same way.
 */
export function clearOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number
): void {
  ctx.resetTransform();
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.scale(dpr, dpr);
}

/**
 * Draws a cursor line at the given character coordinates.
 *
 * Caller controls blink state — only call this when the cursor should be
 * visible. If the cursor is in the "off" phase, simply don't call it
 * (clearOverlay is sufficient to hide it).
 */
export function renderCursor(
  ctx: CanvasRenderingContext2D,
  coords: CoordsResult
): void {
  // +0.5 sub-pixel offset → 1px stroke lands on a physical pixel boundary
  const x = Math.round(coords.x) + 0.5;

  ctx.save();
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, coords.y + 1);
  ctx.lineTo(x, coords.y + coords.height - 1);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws selection highlight rectangles for a set of glyphs.
 *
 * Caller provides glyphs already filtered to the current page and
 * within the selection range (from CharacterMap.glyphsInRange).
 */
export function renderSelection(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[]
): void {
  if (glyphs.length === 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(59, 130, 246, 0.25)"; // blue-500 @ 25% opacity
  for (const glyph of glyphs) {
    ctx.fillRect(glyph.x, glyph.y, glyph.width, glyph.height);
  }
  ctx.restore();
}
