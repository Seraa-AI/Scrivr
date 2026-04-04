import type {
  CoordsResult,
  GlyphEntry,
  LineEntry,
} from "../layout/CharacterMap";

// ── AI / Track-changes overlay helpers ───────────────────────────────────────

/**
 * Draws ghost text (italic, muted) after a block's last line.
 * Used during AI streaming — the document is unchanged, this is cosmetic only.
 *
 * @param x         Left edge of the text (usually the block's left margin)
 * @param y         Top of the virtual line to draw on (usually lastLine.y + lastLine.height)
 * @param maxWidth  Available width before clipping
 * @param lineHeight Approximate line height for measuring
 */
export function renderGhostText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  options?: { fontSize?: number; color?: string; fontFamily?: string },
): void {
  if (!text) return;

  const fontSize = options?.fontSize ?? 14;
  const color = options?.color ?? "rgba(100, 116, 139, 0.65)"; // slate-500, muted
  const fontFamily = options?.fontFamily ?? "Arial, sans-serif";

  ctx.save();
  ctx.font = `italic ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  // Clip to available width so ghost text never bleeds into the margin
  ctx.fillText(text, x, y + (lineHeight - fontSize) / 2, maxWidth);
  ctx.restore();
}

/**
 * Draws a pulsing AI caret line + "AI" label bubble above it.
 * Call on every overlay repaint; pass `visible` to implement blink.
 */
export function renderAiCaret(
  ctx: CanvasRenderingContext2D,
  coords: CoordsResult,
  options?: { color?: string; label?: string; visible?: boolean },
): void {
  const color = options?.color ?? "#a5b4fc"; // indigo-300
  const label = options?.label ?? "AI";
  const visible = options?.visible ?? true;

  const x = Math.round(coords.x) + 0.5;

  ctx.save();

  if (visible) {
    // Caret line (slightly thicker than user cursor to distinguish)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, coords.y + 1);
    ctx.lineTo(x, coords.y + coords.height - 1);
    ctx.stroke();
  }

  // Label bubble (always visible while AI caret is active)
  ctx.font = "bold 10px system-ui, -apple-system, sans-serif";
  const textW = ctx.measureText(label).width;
  const pad = 4;
  const labelW = textW + pad * 2;
  const labelH = 15;
  const labelX = coords.x;
  const labelY = Math.max(0, coords.y - labelH - 2);

  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(labelX, labelY, labelW, labelH, 3);
  } else {
    ctx.rect(labelX, labelY, labelW, labelH);
  }
  ctx.fill();

  ctx.fillStyle = "#1e1b4b"; // indigo-950 for contrast
  ctx.textBaseline = "middle";
  ctx.fillText(label, labelX + pad, labelY + labelH / 2);

  ctx.restore();
}

/**
 * Draws colored highlight bands over glyphs for a tracked insertion.
 * Same two-pass structure as renderSelection but uses the author color.
 */
export function renderTrackedInsert(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  lines: LineEntry[],
  color: string,
): void {
  if (glyphs.length === 0 && lines.length === 0) return;

  ctx.save();
  // Underline + subtle fill — faint enough not to obscure text
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.12) : color;

  // Pass 1 — glyph highlights
  for (const g of glyphs) {
    ctx.fillRect(g.x, g.y, g.width, g.height);
  }

  // Pass 2 — empty lines
  const lineIndexesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const line of lines) {
    if (!lineIndexesWithGlyphs.has(line.lineIndex)) {
      ctx.fillRect(line.x, line.y, line.height, line.height);
    }
  }

  // Underline
  ctx.strokeStyle = color.startsWith("#") ? hexToRgba(color, 0.8) : color;
  ctx.lineWidth = 1.5;
  for (const g of glyphs) {
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + g.height - 1);
    ctx.lineTo(g.x + g.width, g.y + g.height - 1);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws colored bands with strikethrough over glyphs for a tracked deletion.
 */
export function renderTrackedDelete(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  lines: LineEntry[],
  color: string,
): void {
  if (glyphs.length === 0 && lines.length === 0) return;

  ctx.save();
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.12) : color;

  // Pass 1 — glyph highlights
  for (const g of glyphs) {
    ctx.fillRect(g.x, g.y, g.width, g.height);
  }

  // Pass 2 — empty lines
  const lineIndexesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const line of lines) {
    if (!lineIndexesWithGlyphs.has(line.lineIndex)) {
      ctx.fillRect(line.x, line.y, line.height, line.height);
    }
  }

  // Strikethrough — one segment per contiguous docPos run on each line.
  // Sorting by docPos then checking adjacency ensures that non-deleted text
  // inserted between two delete spans (e.g. "~~foo~~ bar ~~baz~~") does not
  // produce a single strikethrough that crosses "bar".
  const sorted = [...glyphs].sort((a, b) =>
    a.lineIndex !== b.lineIndex
      ? a.lineIndex - b.lineIndex
      : a.docPos - b.docPos,
  );

  const runs: Array<{
    minX: number;
    maxX: number;
    midY: number;
    prevDocPos: number;
  }> = [];
  for (const g of sorted) {
    const last = runs[runs.length - 1];
    const midY = g.y + g.height / 2;
    if (last && last.prevDocPos + 1 === g.docPos && last.midY === midY) {
      last.maxX = Math.max(last.maxX, g.x + g.width);
      last.prevDocPos = g.docPos;
    } else {
      runs.push({ minX: g.x, maxX: g.x + g.width, midY, prevDocPos: g.docPos });
    }
  }

  ctx.strokeStyle = color.startsWith("#") ? hexToRgba(color, 0.9) : color;
  ctx.lineWidth = 1.5;
  for (const { minX, maxX, midY } of runs) {
    ctx.beginPath();
    ctx.moveTo(minX, midY);
    ctx.lineTo(maxX, midY);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws a colored left-margin bar for each line of a block whose node
 * attributes were changed (e.g. heading level, alignment).
 *
 * Mirrors Word / Google Docs "formatting changed" bar in the left gutter.
 * Uses a distinct amber palette to avoid confusion with insert (green) and
 * delete (red).
 */
export function renderTrackedAttrChange(
  ctx: CanvasRenderingContext2D,
  lines: LineEntry[],
  color: string,
): void {
  if (lines.length === 0) return;

  ctx.save();

  const BAR_WIDTH = 3;
  const BAR_GAP = 4; // pixels left of the line's x origin

  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.9) : color;

  for (const line of lines) {
    const barX = Math.max(0, line.x - BAR_GAP - BAR_WIDTH);
    ctx.fillRect(barX, line.y, BAR_WIDTH, line.height);
  }

  ctx.restore();
}

/**
 * Draws an amber conflict indicator over glyphs where two authors' marks
 * overlap on the same segment. Rendered on top of the normal insert/delete
 * colour — the underlying green/red is still visible through the amber wash.
 *
 * A dashed amber underline distinguishes this from a normal tracked change.
 */
export function renderTrackedConflict(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  lines: LineEntry[],
): void {
  if (glyphs.length === 0 && lines.length === 0) return;

  const AMBER = "#f59e0b";

  ctx.save();

  // Amber wash on top of the existing change colour
  ctx.fillStyle = hexToRgba(AMBER, 0.18);
  for (const g of glyphs) {
    ctx.fillRect(g.x, g.y, g.width, g.height);
  }
  const lineIndexesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const line of lines) {
    if (!lineIndexesWithGlyphs.has(line.lineIndex)) {
      ctx.fillRect(line.x, line.y, line.height, line.height);
    }
  }

  // Dashed amber underline — visually distinct from the solid insert underline
  ctx.strokeStyle = hexToRgba(AMBER, 0.9);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  for (const g of glyphs) {
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + g.height - 1);
    ctx.lineTo(g.x + g.width, g.y + g.height - 1);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.restore();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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
  dpr: number,
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
  coords: CoordsResult,
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
 * Draws selection highlight rectangles.
 *
 * Two-pass approach:
 *   1. Glyph pass  — draws a highlight rect for every selected glyph (original
 *      behaviour, proven correct for non-empty text).
 *   2. Empty-line pass — for lines that fall within the selection but have no
 *      glyphs (empty paragraphs), draws a small indicator rect so the empty
 *      line is visually highlighted, matching Word / Google Docs behaviour.
 *
 * @param lines   Lines in range, already filtered to the current page.
 * @param glyphs  Glyphs in range, already filtered to the current page.
 * @param from    ProseMirror selection start position (used to find empty lines).
 * @param to      ProseMirror selection end position.
 */
export function renderSelection(
  ctx: CanvasRenderingContext2D,
  lines: LineEntry[],
  glyphs: GlyphEntry[],
  from: number,
  to: number,
): void {
  if (lines.length === 0 && glyphs.length === 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(59, 130, 246, 0.25)"; // blue-500 @ 25% opacity

  // Pass 1 — glyph-based highlights (existing behaviour, unchanged)
  for (const glyph of glyphs) {
    ctx.fillRect(glyph.x, glyph.y, glyph.width, glyph.height);
  }

  // Pass 2 — empty-line highlights
  // Build a set of lineIndex values that already have at least one glyph drawn
  const lineIndexesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const line of lines) {
    if (!lineIndexesWithGlyphs.has(line.lineIndex)) {
      // Empty paragraph — draw a narrow rect (line-height wide) at the left margin
      ctx.fillRect(line.x, line.y, line.height, line.height);
    }
  }

  ctx.restore();
}
