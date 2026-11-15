import type {
  CoordsResult,
  GlyphEntry,
  LineEntry,
} from "../layout/CharacterMap";
import { HANDLE_SIZE } from "./ResizeController";
import { screenPixels, setPaintZoom } from "./zoom";
import type { SelectionPrimitive, SelectionRole } from "../selection/types";
import type { ResolvedTheme } from "../model/theme";

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
  renderLabelledCaret(ctx, coords, {
    color: options?.color ?? "#a5b4fc", // indigo-300
    label: options?.label ?? "AI",
    labelColor: "#1e1b4b", // indigo-950 for contrast
    visible: options?.visible ?? true,
  });
}

/**
 * Another hand's caret — a collaborator's, the AI's — with its name in a
 * bubble above it. Pointer furniture: the same size on screen at every zoom.
 * `visible: false` hides the line for a blink; the name stays.
 */
export function renderLabelledCaret(
  ctx: CanvasRenderingContext2D,
  coords: Pick<CoordsResult, "x" | "y" | "height">,
  options: { color: string; label: string; labelColor?: string; visible?: boolean },
): void {
  const { color, label, labelColor = "#ffffff", visible = true } = options;
  const x = onPixelCentre(coords.x);

  ctx.save();

  if (visible) {
    // Slightly thicker than the user's own caret, to tell them apart.
    ctx.strokeStyle = color;
    ctx.lineWidth = screenPixels(2);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, coords.y + screenPixels(1));
    ctx.lineTo(x, coords.y + coords.height - screenPixels(1));
    ctx.stroke();
  }

  ctx.font = `bold ${screenPixels(11)}px system-ui, -apple-system, sans-serif`;
  const pad = screenPixels(4);
  const labelW = ctx.measureText(label).width + pad * 2;
  const labelH = screenPixels(16);
  const labelX = coords.x;
  const labelY = Math.max(0, coords.y - labelH - screenPixels(2));

  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(labelX, labelY, labelW, labelH, screenPixels(3));
  } else {
    ctx.rect(labelX, labelY, labelW, labelH);
  }
  ctx.fill();

  ctx.fillStyle = labelColor;
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
    snappedFillRect(ctx, g.x, g.y, g.width, g.height);
  }

  // Pass 2 — empty lines
  fillEmptyLines(ctx, glyphs, lines);

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
    snappedFillRect(ctx, g.x, g.y, g.width, g.height);
  }

  // Pass 2 — empty lines
  fillEmptyLines(ctx, glyphs, lines);

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
    snappedFillRect(ctx, barX, line.y, BAR_WIDTH, line.height);
  }

  ctx.restore();
}

/**
 * Marks a whole table row a change added or removed: a wash across the row and
 * a frame around it, dashed when the row is removed.
 */
export function renderTrackedRow(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  color: string,
  removed: boolean,
): void {
  ctx.save();
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.1) : color;
  snappedFillRect(ctx, rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = color.startsWith("#") ? hexToRgba(color, 0.9) : color;
  ctx.lineWidth = 2;
  ctx.setLineDash(removed ? [6, 4] : []);
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  ctx.restore();
}

/**
 * Marks moved content as Word does: double-underlined where it moved to,
 * double-struck where it moved from, over a light wash. Edits made inside a
 * moved block are painted over it with their own marks.
 */
export function renderTrackedMove(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  lines: LineEntry[],
  color: string,
  removed: boolean,
): void {
  if (glyphs.length === 0 && lines.length === 0) return;
  ctx.save();
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.08) : color;
  for (const g of glyphs) snappedFillRect(ctx, g.x, g.y, g.width, g.height);
  fillEmptyLines(ctx, glyphs, lines);
  ctx.strokeStyle = color.startsWith("#") ? hexToRgba(color, 0.9) : color;
  ctx.lineWidth = 1;
  // One pair of lines per run of glyphs on a line, not per glyph.
  const runs = new Map<string, { x: number; end: number; y: number; height: number }>();
  for (const g of glyphs) {
    const key = `${g.page}:${g.lineIndex}`;
    const run = runs.get(key);
    if (run) {
      run.x = Math.min(run.x, g.x);
      run.end = Math.max(run.end, g.x + g.width);
    } else {
      runs.set(key, { x: g.x, end: g.x + g.width, y: g.y, height: g.height });
    }
  }
  for (const { x, end, y, height } of runs.values()) {
    const first = removed ? y + height * 0.45 : y + height - 3;
    for (const lineY of [first, first + 2.5]) {
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(end, lineY);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Washes text whose formatting a tracked change altered. No underline: the text
 * is neither added nor removed, and an underline would read as underlining.
 */
export function renderTrackedFormatting(
  ctx: CanvasRenderingContext2D,
  glyphs: GlyphEntry[],
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.18) : color;
  for (const g of glyphs) snappedFillRect(ctx, g.x, g.y, g.width, g.height);
  ctx.restore();
}

/**
 * Frames an object with a tracked change — an image, a rule, a page break —
 * which has no text to underline or strike through. Added content gets a
 * coloured frame and wash; removed content is also struck through, corner to
 * corner, as Word marks a deleted object.
 */
export function renderTrackedObject(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  color: string,
  removed: boolean,
): void {
  ctx.save();
  ctx.fillStyle = color.startsWith("#") ? hexToRgba(color, 0.12) : color;
  snappedFillRect(ctx, rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = color.startsWith("#") ? hexToRgba(color, 0.9) : color;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  if (removed) {
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.height);
    ctx.lineTo(rect.x + rect.width, rect.y);
    ctx.stroke();
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
    snappedFillRect(ctx, g.x, g.y, g.width, g.height);
  }
  fillEmptyLines(ctx, glyphs, lines);

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

// ── Anchored-object drag overlay ─────────────────────────────────────────────

/**
 * Faint dashed outline at the original location of an anchored object that's
 * being dragged. Tells the user "this is where the image came from" so the
 * ghost-vs-source relationship is obvious.
 */
export function renderAnchoredDragSource(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;

  ctx.save();
  ctx.fillStyle = "rgba(148, 163, 184, 0.10)"; // slate-400 wash
  snappedFillRect(ctx, x, y, width, height);

  ctx.strokeStyle = "rgba(100, 116, 139, 0.55)"; // slate-500
  ctx.lineWidth = screenPixels(1);
  ctx.setLineDash([screenPixels(4), screenPixels(3)]);
  strokeInside(ctx, x, y, width, height);
  ctx.restore();
}

/**
 * Translucent rect that follows the cursor while an anchored object is being
 * dragged. Shows where the image will land if the user releases now.
 *
 * `disabled` swaps the blue accent for a muted slate wash so the user can
 * see what they're dragging but is signalled "this drop won't commit" — used
 * when the cursor is in an inter-page gap (no valid drop target).
 */
export function renderAnchoredDragGhost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options?: { disabled?: boolean },
): void {
  if (width <= 0 || height <= 0) return;

  const disabled = options?.disabled === true;
  const fill = disabled
    ? "rgba(148, 163, 184, 0.18)"  // slate-400 wash
    : "rgba(59, 130, 246, 0.18)";  // blue-500 wash
  const stroke = disabled
    ? "rgba(100, 116, 139, 0.85)"  // slate-500
    : "rgba(37, 99, 235, 0.85)";   // blue-600

  ctx.save();
  ctx.fillStyle = fill;
  snappedFillRect(ctx, x, y, width, height);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = screenPixels(1.5);
  if (disabled) ctx.setLineDash([screenPixels(4), screenPixels(3)]);
  strokeInside(ctx, x, y, width, height);
  ctx.restore();
}

/**
 * Vertical caret at the resolved insertion point during an anchored-object
 * drag — mirrors Word/Docs "this is where the anchor will land" indicator.
 */
export function renderAnchoredDragCaret(
  ctx: CanvasRenderingContext2D,
  coords: { x: number; y: number; height: number },
): void {
  const x = onPixelCentre(coords.x);
  const inset = screenPixels(1);

  ctx.save();
  ctx.strokeStyle = "rgba(37, 99, 235, 0.9)"; // blue-600
  ctx.lineWidth = screenPixels(2);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, coords.y + inset);
  ctx.lineTo(x, coords.y + coords.height - inset);
  ctx.stroke();
  ctx.restore();
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Device pixels per page unit in the overlay paint under way, as
 * `setupCanvas` returned it — used for pixel-grid snapping. Set by clearOverlay at
 * the start of each paint so every draw in it snaps alike without threading
 * the value through every API.
 */
let activeDpr = 1;

/** Moves a page-unit x to the centre of its device pixel, so a stroke one device pixel wide lands on one pixel. */
const onPixelCentre = (x: number): number => (Math.round(x * activeDpr) + 0.5) / activeDpr;

/** @internal Set the active DPR for testing snapRect without calling clearOverlay. */
export function setActiveDpr(dpr: number): void {
  activeDpr = dpr;
}

/**
 * Snaps a rectangle to the device pixel grid so adjacent rects share exact
 * pixel boundaries — eliminates antialiasing seams between selection rects.
 * @internal Exported for testing only.
 */
export function snapRect(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const dpr = activeDpr;
  const sx = Math.round(x * dpr) / dpr;
  const sy = Math.round(y * dpr) / dpr;
  const sw = Math.round((x + w) * dpr) / dpr - sx;
  const sh = Math.round((y + h) * dpr) / dpr - sy;
  return { x: sx, y: sy, w: sw, h: sh };
}

/**
 * Marks each line that holds no text with a line-high square at its start, so
 * an empty paragraph still shows its change. The caret's zero-width glyph on
 * an empty line is not text.
 */
function fillEmptyLines(ctx: CanvasRenderingContext2D, glyphs: GlyphEntry[], lines: LineEntry[]): void {
  const linesWithText = new Set(glyphs.filter((g) => g.width > 0).map((g) => g.lineIndex));
  for (const line of lines) {
    if (!linesWithText.has(line.lineIndex)) snappedFillRect(ctx, line.x, line.y, line.height, line.height);
  }
}

/** fillRect snapped to the device pixel grid. */
function snappedFillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = snapRect(x, y, w, h);
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** strokeRect for a line one device pixel inside the rect's edges, on pixel centres. */
function strokeInside(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const left = onPixelCentre(x);
  const top = onPixelCentre(y);
  const pixel = 1 / activeDpr;
  ctx.strokeRect(left, top, onPixelCentre(x + w) - left - pixel, onPixelCentre(y + h) - top - pixel);
}

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
 * can treat content and overlay canvases the same way. `dpr` is device pixels
 * per page unit, as `setupCanvas` returns it; `zoom` the view's.
 *
 * Starts a paint: records `dpr` for pixel snapping and `zoom` for
 * `screenPixels`, which every draw until the next clear reads.
 */
export function clearOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  zoom = 1,
): void {
  activeDpr = dpr;
  setPaintZoom(zoom);
  ctx.resetTransform();
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.scale(dpr, dpr);
}

/** Map a primitive's semantic role to its theme color. */
function roleColor(role: SelectionRole, theme: ResolvedTheme): string {
  switch (role) {
    case "caret":
      return theme.cursor;
    case "affordance":
      return theme.resizeHandle;
    case "selection":
      return theme.selectionFill;
  }
}

/**
 * Paints selection geometry primitives emitted by a SelectionBehavior. The only
 * selection-drawing entry point the renderer needs — it never learns whether the
 * primitives describe text, an image, a table, or a custom node; it maps each
 * primitive's `role` to a theme color. The caller decides which primitives to
 * pass (e.g. dropping the caret when the blink is off, or the handles during a
 * resize-ghost drag).
 */
export function paintSelectionPrimitives(
  ctx: CanvasRenderingContext2D,
  primitives: readonly SelectionPrimitive[],
  theme: ResolvedTheme,
): void {
  for (const p of primitives) {
    ctx.save();
    switch (p.type) {
      case "fill":
        ctx.fillStyle = roleColor(p.role ?? "selection", theme);
        for (const r of p.rects) snappedFillRect(ctx, r.x, r.y, r.width, r.height);
        break;
      case "outline":
        ctx.strokeStyle = roleColor(p.role ?? "affordance", theme);
        ctx.lineWidth = screenPixels(p.width);
        ctx.strokeRect(p.rect.x, p.rect.y, p.rect.width, p.rect.height);
        break;
      case "handles": {
        ctx.fillStyle = roleColor(p.role ?? "affordance", theme);
        const size = screenPixels(HANDLE_SIZE);
        for (const h of p.handles) {
          ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
        }
        break;
      }
      case "caret":
        renderCursor(ctx, p, theme.cursor);
        break;
    }
    ctx.restore();
  }
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
  coords: Pick<CoordsResult, "x" | "y" | "height">,
  cursorColor: string,
): void {
  if (coords.height <= 0) return;

  const x = onPixelCentre(coords.x);
  const inset = screenPixels(1);

  ctx.save();
  ctx.strokeStyle = cursorColor;
  ctx.lineWidth = screenPixels(1.5);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, coords.y + inset);
  ctx.lineTo(x, coords.y + coords.height - inset);
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
  selectionFill: string,
): void {
  if (lines.length === 0 && glyphs.length === 0) return;

  ctx.save();
  ctx.fillStyle = selectionFill;

  // Pass 1 — glyph-based highlights (snapped to pixel grid to eliminate seams)
  for (const glyph of glyphs) {
    if (glyph.height <= 0) continue;
    snappedFillRect(ctx, glyph.x, glyph.y, glyph.width, glyph.height);
  }

  // Pass 2 — empty-line highlights
  // Build a set of lineIndex values that already have at least one glyph drawn
  const lineIndexesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const line of lines) {
    if (line.height <= 0) continue;
    if (!lineIndexesWithGlyphs.has(line.lineIndex)) {
      // Empty paragraph — draw a narrow rect (line-height wide) at the left margin
      snappedFillRect(ctx, line.x, line.y, line.height, line.height);
    }
  }

  ctx.restore();
}
