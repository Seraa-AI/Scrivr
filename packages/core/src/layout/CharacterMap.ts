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
    const line = this.lineAtCoords(y, page);
    if (!line) return 0;

    const lineGlyphs = this.glyphs.filter(
      (g) => g.page === page && g.lineIndex === line.lineIndex
    );

    if (lineGlyphs.length === 0) return line.startDocPos;

    for (const glyph of lineGlyphs) {
      const midpoint = glyph.x + glyph.width / 2;
      if (x <= midpoint) {
        // Click is on the left half — position is before this glyph
        return glyph.docPos;
      }
    }

    // Click is past all glyphs on the line — position is end of line
    return line.endDocPos;
  }

  /**
   * coordsAtPos — reverse lookup.
   *
   * Given a ProseMirror document position, returns the pixel coordinates
   * where the cursor should be drawn.
   *
   * If the position falls between two glyphs, returns the right edge of
   * the preceding glyph (i.e. the left edge of the gap).
   */
  coordsAtPos(docPos: number): CoordsResult | null {
    // Exact match — start of a glyph
    const exact = this.glyphs.find((g) => g.docPos === docPos);
    if (exact) {
      return { x: exact.x, y: exact.y, height: exact.height, page: exact.page };
    }

    // Position is after the last glyph on a line — draw cursor at its right edge
    const preceding = [...this.glyphs]
      .reverse()
      .find((g) => g.docPos < docPos);

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
   * Returns all glyphs that fall within the given ProseMirror position range.
   * Used by the renderer to draw selection highlight rectangles.
   */
  glyphsInRange(from: number, to: number): GlyphEntry[] {
    return this.glyphs.filter((g) => g.docPos >= from && g.docPos < to);
  }

  // Internal — find which line a y coordinate lands on
  private lineAtCoords(y: number, page: number): LineEntry | undefined {
    return this.lines.find(
      (l) => l.page === page && y >= l.y && y < l.y + l.height
    );
  }
}
