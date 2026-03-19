import { describe, it, expect, beforeEach } from "vitest";
import { CharacterMap } from "./CharacterMap";

/**
 * CharacterMap tests.
 *
 * We populate the map manually with known glyph positions, then assert
 * that posAtCoords and coordsAtPos return the right values.
 *
 * These are the most important tests in the codebase — if hit testing
 * is wrong, every click lands on the wrong character.
 */

// Helpers to build a realistic scenario:
// A single line on page 1 with 4 characters: "Word"
// W=10px  o=8px  r=7px  d=9px  total=34px
// Line starts at x=40 (left margin), y=60

function buildSingleLinePage(map: CharacterMap) {
  const chars = [
    { char: "W", width: 10 },
    { char: "o", width: 8 },
    { char: "r", width: 7 },
    { char: "d", width: 9 },
  ];

  map.registerLine({
    page: 1,
    lineIndex: 0,
    y: 60,
    height: 20,
    startDocPos: 1,
    endDocPos: 5,
  });

  let x = 40;
  let docPos = 1;
  for (const { width } of chars) {
    map.registerGlyph({
      docPos,
      x,
      y: 60,
      width,
      height: 20,
      page: 1,
      lineIndex: 0,
    });
    x += width;
    docPos++;
  }
}

describe("CharacterMap", () => {
  let map: CharacterMap;

  beforeEach(() => {
    map = new CharacterMap();
    buildSingleLinePage(map);
  });

  describe("posAtCoords", () => {
    it("returns the position of the first character when clicking at line start", () => {
      // x=40 is the left edge of "W" — should snap to docPos 1
      expect(map.posAtCoords(40, 65, 1)).toBe(1);
    });

    it("snaps to the next position when clicking past midpoint of a glyph", () => {
      // "W" is 10px wide at x=40..50. Midpoint = 45.
      // Click at x=46 (past midpoint) should return pos 2 (after "W")
      expect(map.posAtCoords(46, 65, 1)).toBe(2);
    });

    it("snaps to the current position when clicking before midpoint of a glyph", () => {
      // "W" midpoint = 45. Click at x=44 should return pos 1 (before "W")
      expect(map.posAtCoords(44, 65, 1)).toBe(1);
    });

    it("returns end of line position when clicking past all glyphs", () => {
      // Line ends at x=74. Click at x=200 should return endDocPos=5
      expect(map.posAtCoords(200, 65, 1)).toBe(5);
    });

    it("returns 0 when clicking on a y coordinate with no line", () => {
      expect(map.posAtCoords(50, 200, 1)).toBe(0);
    });

    it("returns 0 when clicking on the wrong page", () => {
      expect(map.posAtCoords(50, 65, 2)).toBe(0);
    });
  });

  describe("coordsAtPos", () => {
    it("returns the x position of the first glyph for docPos 1", () => {
      const coords = map.coordsAtPos(1);
      expect(coords?.x).toBe(40);
      expect(coords?.page).toBe(1);
    });

    it("returns the x position of the second glyph for docPos 2", () => {
      // "W" is 10px, so "o" starts at x=50
      const coords = map.coordsAtPos(2);
      expect(coords?.x).toBe(50);
    });

    it("returns the right edge of the last glyph when pos is after all glyphs", () => {
      // Last glyph "d" starts at x=65, width=9, so right edge = 74
      const coords = map.coordsAtPos(5);
      expect(coords?.x).toBe(74);
    });

    it("returns null when pos is before any glyph", () => {
      const coords = map.coordsAtPos(0);
      expect(coords).toBeNull();
    });
  });

  describe("glyphsInRange", () => {
    it("returns glyphs that fall within a selection range", () => {
      // docPos 1..3 = "W", "o"
      const selected = map.glyphsInRange(1, 3);
      expect(selected).toHaveLength(2);
      expect(selected[0]?.docPos).toBe(1);
      expect(selected[1]?.docPos).toBe(2);
    });

    it("returns empty array when range has no glyphs", () => {
      expect(map.glyphsInRange(10, 20)).toHaveLength(0);
    });

    it("is exclusive of the end position (standard ProseMirror range convention)", () => {
      // Range 1..2 should include only the glyph at pos 1
      const selected = map.glyphsInRange(1, 2);
      expect(selected).toHaveLength(1);
      expect(selected[0]?.docPos).toBe(1);
    });
  });

  describe("clear", () => {
    it("removes all glyphs and lines", () => {
      map.clear();
      expect(map.posAtCoords(50, 65, 1)).toBe(0);
      expect(map.coordsAtPos(1)).toBeNull();
    });
  });
});
