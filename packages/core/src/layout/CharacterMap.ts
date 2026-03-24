/**
 * CharacterMap — the glyph index that makes hit testing possible.
 *
 * The layout engine writes every rendered glyph into this structure.
 * The input handler reads from it to answer two questions:
 *
 *   posAtCoords(x, y, page)  — "user clicked here, which doc position is that?"
 *   coordsAtPos(pos)         — "cursor is at doc position 42, where do I draw it?"
 *
 * This is the bridge between pixel space and ProseMirror position space.
 */

export interface GlyphEntry {
  /** ProseMirror integer position — what you pass to EditorState for selection */
  docPos: number;
  /** Left edge of this glyph in canvas coordinates */
  x: number;
  /** Top of the line this glyph sits on */
  y: number;
  /** Measured width of this glyph */
  width: number;
  /** Line height (ascent + descent) */
  height: number;
  /** 1-based page number */
  page: number;
  /** Index of the line within its page (0-based) */
  lineIndex: number;
}

export interface LineEntry {
  page: number;
  lineIndex: number;
  /** y coordinate of the top of this line */
  y: number;
  /** Total height of this line */
  height: number;
  /** Left edge of the content area (page margin x) */
  x: number;
  /** Full available width of the content area */
  contentWidth: number;
  /** ProseMirror position at the very start of this line */
  startDocPos: number;
  /** ProseMirror position just past the last glyph on this line */
  endDocPos: number;
}

export interface CoordsResult {
  /** Left edge of the character at this doc position */
  x: number;
  /** Top of the line */
  y: number;
  /** Line height — useful for drawing the cursor */
  height: number;
  page: number;
}

export class CharacterMap {
  private glyphs: GlyphEntry[] = [];
  private lines: LineEntry[] = [];

  // Called by the layout engine after each layout pass
  clear(): void {
    this.glyphs = [];
    this.lines = [];
  }

  registerGlyph(entry: GlyphEntry): void {
    this.glyphs.push(entry);
  }

  registerLine(entry: LineEntry): void {
    this.lines.push(entry);
  }

  /**
   * posAtCoords — the hit test.
   *
   * Given a click at (x, y) on a specific page, returns the ProseMirror
   * document position closest to that point.
   *
   * Algorithm:
   *   1. Find the line on this page whose y range contains the click y.
   *   2. Walk glyphs on that line left to right, summing widths.
   *   3. If click x is past the midpoint of a glyph, snap to the position
   *      after it; otherwise snap to the position before it.
   */
  posAtCoords(x: number, y: number, page: number): number {
    // Try exact hit first; fall back to nearest line if click is in a margin
    const line = this.lineAtCoords(y, page) ?? this.nearestLine(y, page);
    if (!line) return 0;

    // Filter by y coordinate rather than lineIndex so that table cells —
    // which share the same y but have different lineIndex values — all
    // participate in the x hit-test. Sort left-to-right for safety.
    const lineGlyphs = this.glyphs
      .filter((g) => g.page === page && g.y === line.y)
      .sort((a, b) => a.x - b.x);

    if (!lineGlyphs.length) return line.startDocPos;

    for (const glyph of lineGlyphs) {
      const midpoint = glyph.x + glyph.width / 2;
      if (x <= midpoint) {
        // Click is on the left half — position is before this glyph
        return glyph.docPos;
      }
    }

    // Click is past all glyphs at this y — return end of whichever line
    // owns the rightmost glyph (handles multi-cell rows correctly).
    const rightmost = lineGlyphs[lineGlyphs.length - 1]!;
    const rightLine = this.lines.find(
      (l) => l.page === page && l.lineIndex === rightmost.lineIndex,
    );
    return rightLine?.endDocPos ?? rightmost.docPos + 1;
  }

  /**
   * coordsAtPos — reverse lookup.
   *
   * Given a ProseMirror document position, returns the pixel coordinates
   * where the cursor should be drawn.
   *
   * If the position falls between two glyphs, returns the right edge of
   * the preceding glyph (i.e. the left edge of the gap).
   *
   * @param scopeToPage — when provided, both the exact and preceding-glyph
   *   searches are restricted to glyphs on that page. Use this when rendering
   *   the cursor overlay so the fallback can never land on a glyph from a
   *   different page's canvas (which would cause the cursor to disappear or
   *   jump). Callers that need cross-page data (posAbove, posBelow) omit this.
   */
  coordsAtPos(docPos: number, scopeToPage?: number): CoordsResult | null {
    const pool =
      scopeToPage !== undefined
        ? this.glyphs.filter((g) => g.page === scopeToPage)
        : this.glyphs;

    // Exact match — start of a glyph
    const exact = pool.find((g) => g.docPos === docPos);
    if (exact) {
      return { x: exact.x, y: exact.y, height: exact.height, page: exact.page };
    }

    // Position is after the last glyph on a line — draw cursor at its right edge
    const preceding = [...pool].reverse().find((g) => g.docPos < docPos);
    if (preceding) {
      return {
        x: preceding.x + preceding.width,
        y: preceding.y,
        height: preceding.height,
        page: preceding.page,
      };
    }

    return null;
  }

  /**
   * Find the doc position directly above the current cursor, preserving x.
   *
   * Uses y-coordinate comparison rather than lineIndex arithmetic so that
   * table cells (which share the same y but have different lineIndex values)
   * navigate correctly — ↑ from any cell in a table row moves to the row
   * above, not to a sibling cell.
   *
   * Returns null if no line above is registered (top of document, or the
   * page above hasn't been rendered yet by the virtual page system).
   */
  posAbove(docPos: number, x: number): number | null {
    const coords = this.coordsAtPos(docPos);
    if (!coords) return null;

    const currentLine = this.lineAtCoords(coords.y, coords.page);
    if (!currentLine) return null;

    // Find the highest line on this page that is strictly above currentLine.y
    const above = this.lines
      .filter((l) => l.page === currentLine.page && l.y < currentLine.y)
      .reduce<
        LineEntry | undefined
      >((best, l) => (best === undefined || l.y > best.y ? l : best), undefined);

    if (above)
      return this.posAtCoords(x, above.y + above.height / 2, above.page);

    // First visual row on this page — jump to the last line of the previous page
    const prevPageLines = this.lines.filter(
      (l) => l.page === currentLine.page - 1,
    );
    if (!prevPageLines.length) return null;
    const lastOnPrev = prevPageLines.reduce((max, l) =>
      l.y > max.y ? l : max,
    );
    return this.posAtCoords(
      x,
      lastOnPrev.y + lastOnPrev.height / 2,
      lastOnPrev.page,
    );
  }

  /**
   * Find the doc position directly below the current cursor, preserving x.
   *
   * Uses y-coordinate comparison (mirrors posAbove) so table row navigation
   * works correctly.
   *
   * Returns null if no line below is registered (bottom of document, or the
   * next page hasn't been rendered yet).
   */
  posBelow(docPos: number, x: number): number | null {
    const coords = this.coordsAtPos(docPos);
    if (!coords) return null;

    const currentLine = this.lineAtCoords(coords.y, coords.page);
    if (!currentLine) return null;

    // Find the lowest line on this page that starts strictly below currentLine's bottom
    const currentBottom = currentLine.y + currentLine.height;
    const below = this.lines
      .filter((l) => l.page === currentLine.page && l.y >= currentBottom)
      .reduce<
        LineEntry | undefined
      >((best, l) => (best === undefined || l.y < best.y ? l : best), undefined);

    if (below)
      return this.posAtCoords(x, below.y + below.height / 2, below.page);

    // Last visual row on this page — jump to the first line of the next page
    const nextPageLines = this.lines.filter(
      (l) => l.page === currentLine.page + 1,
    );
    if (!nextPageLines.length) return null;
    const firstOnNext = nextPageLines.reduce((min, l) =>
      l.y < min.y ? l : min,
    );
    return this.posAtCoords(
      x,
      firstOnNext.y + firstOnNext.height / 2,
      firstOnNext.page,
    );
  }

  /**
   * Returns all glyphs that fall within the given ProseMirror position range.
   * Used by the renderer to draw selection highlight rectangles.
   */
  glyphsInRange(from: number, to: number): GlyphEntry[] {
    return this.glyphs.filter((g) => g.docPos >= from && g.docPos < to);
  }

  /**
   * Returns all lines that overlap the given ProseMirror position range.
   * Includes empty lines (startDocPos === endDocPos) when the cursor position
   * falls within [from, to). Used by the renderer to draw full-line selection
   * highlights, including for empty paragraphs.
   */
  linesInRange(from: number, to: number): LineEntry[] {
    return this.lines.filter((l) => {
      if (l.startDocPos === l.endDocPos) {
        // Empty line — include when the cursor position is within the selection
        return l.startDocPos >= from && l.startDocPos < to;
      }
      // Non-empty line — include when any character is within the selection
      return l.startDocPos < to && l.endDocPos > from;
    });
  }

  /** Returns true if a glyph at this docPos is already registered */
  hasGlyph(docPos: number): boolean {
    return this.glyphs.some((g) => g.docPos === docPos);
  }

  /** Returns true if a line entry exists for this page + lineIndex */
  hasLine(page: number, lineIndex: number): boolean {
    return this.lines.some((l) => l.page === page && l.lineIndex === lineIndex);
  }

  // Internal — find which line a y coordinate lands on
  private lineAtCoords(y: number, page: number): LineEntry | undefined {
    return this.lines.find(
      (l) => l.page === page && y >= l.y && y < l.y + l.height,
    );
  }

  // Internal — find the closest line when y is outside all line ranges.
  // Click above first line → first line. Click below last line → last line.
  private nearestLine(y: number, page: number): LineEntry | undefined {
    const pageLines = this.lines.filter((l) => l.page === page);
    if (!pageLines.length) return undefined;
    return pageLines.reduce((closest, line) => {
      const closestDist = Math.min(
        Math.abs(y - closest.y),
        Math.abs(y - (closest.y + closest.height)),
      );
      const lineDist = Math.min(
        Math.abs(y - line.y),
        Math.abs(y - (line.y + line.height)),
      );
      return lineDist < closestDist ? line : closest;
    });
  }
}
