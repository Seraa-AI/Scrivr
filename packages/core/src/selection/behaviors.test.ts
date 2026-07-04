import { describe, it, expect } from "vitest";
import { rangeBandRects } from "./behaviors";
import type { GlyphEntry, LineEntry } from "../layout/CharacterMap";

// Content area: left margin 80, width 400 → right margin 480.
function line(lineIndex: number, y: number, startDocPos: number, endDocPos: number): LineEntry {
  return { page: 1, lineIndex, y, height: 20, x: 80, contentWidth: 400, startDocPos, endDocPos };
}
function glyph(lineIndex: number, docPos: number, x: number, width = 8): GlyphEntry {
  return { docPos, x, y: 0, lineY: 0, width, height: 16, page: 1, lineIndex };
}

describe("rangeBandRects", () => {
  it("emits one full-height band per line: first→margin, middle full, last→end", () => {
    // Selection 6..40 spans three lines.
    const lines = [line(0, 100, 1, 15), line(1, 120, 15, 28), line(2, 140, 28, 45)];
    const glyphs = [
      glyph(0, 6, 150), // first line starts mid-line at x=150
      glyph(1, 20, 90),
      glyph(2, 30, 88), // last line ends at x=88+8=96
    ];
    const rects = rangeBandRects(6, 40, glyphs, lines);
    expect(rects).toHaveLength(3);
    // First line: from the start glyph to the right margin.
    expect(rects[0]).toEqual({ x: 150, y: 100, width: 480 - 150, height: 20 });
    // Middle line: whole content width.
    expect(rects[1]).toEqual({ x: 80, y: 120, width: 400, height: 20 });
    // Last line: from the left margin to the selection end glyph.
    expect(rects[2]).toEqual({ x: 80, y: 140, width: 96 - 80, height: 20 });
  });

  it("covers an interior line with no glyphs (block atom / empty para) full width", () => {
    // Middle line 1 has no glyphs (e.g. a horizontal rule between two paragraphs).
    const lines = [line(0, 100, 1, 15), line(1, 120, 15, 16), line(2, 140, 16, 30)];
    const glyphs = [glyph(0, 6, 150), glyph(2, 20, 88)];
    const rects = rangeBandRects(6, 25, glyphs, lines);
    expect(rects).toHaveLength(3);
    expect(rects[1]).toEqual({ x: 80, y: 120, width: 400, height: 20 });
  });

  it("fills a fully-covered block atom even when the selection ends at its boundary", () => {
    // Line 1 is a block atom (no glyphs); selection 6..16 ends exactly at its
    // endDocPos, so `endsAfter` is false — but it's fully covered, so full width.
    const lines = [line(0, 100, 1, 15), line(1, 120, 15, 16)];
    const glyphs = [glyph(0, 6, 150)];
    const rects = rangeBandRects(6, 16, glyphs, lines);
    expect(rects).toHaveLength(2);
    expect(rects[1]).toEqual({ x: 80, y: 120, width: 400, height: 20 });
  });

  it("keeps a single-line selection to its glyph span", () => {
    const lines = [line(0, 100, 1, 30)];
    const glyphs = [glyph(0, 6, 150), glyph(0, 7, 158)];
    const rects = rangeBandRects(6, 8, glyphs, lines);
    expect(rects).toHaveLength(1);
    // Not extended to the margin — selection starts and ends on this line.
    expect(rects[0]).toEqual({ x: 150, y: 100, width: 166 - 150, height: 20 });
  });
});
