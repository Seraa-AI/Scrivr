import { describe, it, expect, beforeEach } from "vitest";
import { CharacterMap } from "./CharacterMap";

// Two-line helper used by posAbove / posBelow tests.
// Page 1, line 0: "Hello" at docPos 1-5, y=60, each char 10px wide
// Page 1, line 1: "World" at docPos 6-10, y=80, each char 10px wide
function buildTwoLinePage(map: CharacterMap) {
  for (let i = 0; i < 5; i++) {
    map.registerGlyph({ docPos: 1 + i, x: i * 10, y: 60, lineY: 60, width: 10, height: 20, page: 1, lineIndex: 0 });
  }
  for (let i = 0; i < 5; i++) {
    map.registerGlyph({ docPos: 6 + i, x: i * 10, y: 80, lineY: 80, width: 10, height: 20, page: 1, lineIndex: 1 });
  }
  map.registerLine({ page: 1, lineIndex: 0, y: 60, height: 20, x: 0, contentWidth: 400, startDocPos: 1, endDocPos: 6 });
  map.registerLine({ page: 1, lineIndex: 1, y: 80, height: 20, x: 0, contentWidth: 400, startDocPos: 6, endDocPos: 11 });
}

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
    x: 40,
    contentWidth: 400,
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
      lineY: 60,
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

    it("snaps to nearest line when clicking below all lines (not returning 0)", () => {
      // y=200 is below the only line (y=60, height=20). Should snap to that
      // line and return a position within it, not 0 (document start).
      const pos = map.posAtCoords(50, 200, 1);
      expect(pos).toBeGreaterThan(0);
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

    it("scopeToPage: returns null instead of crossing to preceding glyph on a different page", () => {
      // Simulates the lazy-charmap scenario: page 1 is populated, page 2 is not.
      // The cursor is at the very first position on page 2 (docPos 100).
      // Without scoping, coordsAtPos falls back to the last glyph on page 1 (docPos 4)
      // and returns page=1 coords — causing the cursor to be drawn on the wrong canvas.
      // With scopeToPage=2, the search is restricted to page 2's glyphs, returning null,
      // so the cursor is simply not drawn on page 1's overlay (correct behaviour).
      const crossMap = new CharacterMap();
      // Page 1 has glyphs at docPos 1–4
      crossMap.registerGlyph({ docPos: 1, x: 0, y: 60, lineY: 60, width: 10, height: 20, page: 1, lineIndex: 0 });
      crossMap.registerGlyph({ docPos: 4, x: 30, y: 60, lineY: 60, width: 10, height: 20, page: 1, lineIndex: 0 });
      // Page 2 has a glyph at docPos 101 but NOT at 100 (cursor is at the boundary)
      crossMap.registerGlyph({ docPos: 101, x: 72, y: 72, lineY: 72, width: 10, height: 20, page: 2, lineIndex: 0 });

      // Unscoped: falls back to page 1's glyph at docPos 4
      const unscoped = crossMap.coordsAtPos(100);
      expect(unscoped?.page).toBe(1);

      // Scoped to page 2: no preceding glyph on page 2 before docPos 100 → null
      const scoped = crossMap.coordsAtPos(100, 2);
      expect(scoped).toBeNull();

      // Scoped to page 2: exact match at docPos 101 is found
      const exact = crossMap.coordsAtPos(101, 2);
      expect(exact?.page).toBe(2);
      expect(exact?.x).toBe(72);
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

  describe("clearPage", () => {
    it("removes glyphs and lines for the specified page only", () => {
      // Register a second page alongside the existing page 1
      map.registerGlyph({ docPos: 20, x: 40, y: 60, lineY: 60, width: 10, height: 20, page: 2, lineIndex: 0 });
      map.registerLine({ page: 2, lineIndex: 0, y: 60, height: 20, x: 40, contentWidth: 400, startDocPos: 20, endDocPos: 21 });

      map.clearPage(2);

      // Page 2 glyphs/lines are gone
      expect(map.posAtCoords(40, 60, 2)).toBe(0);
      // Scope to page 2 — no preceding glyph on page 2 should remain after clear
      expect(map.coordsAtPos(20, 2)).toBeNull();

      // Page 1 is untouched
      const coords = map.coordsAtPos(1);
      expect(coords?.page).toBe(1);
    });

    it("removes objectRects for the specified page", () => {
      map.registerObjectRect({ docPos: 50, x: 0, y: 0, width: 100, height: 100, page: 1 });
      map.registerObjectRect({ docPos: 51, x: 0, y: 0, width: 100, height: 100, page: 2 });

      map.clearPage(1);

      expect(map.getObjectRect(50)).toBeUndefined();
      expect(map.getObjectRect(51)).toBeDefined();
    });

    it("is a no-op when the page has no entries", () => {
      // Should not throw on an empty page
      expect(() => map.clearPage(99)).not.toThrow();
      // Existing page 1 data is intact
      expect(map.coordsAtPos(1)?.page).toBe(1);
    });

    it("clearing page 1 leaves an empty map (posAtCoords returns 0)", () => {
      map.clearPage(1);
      expect(map.posAtCoords(50, 65, 1)).toBe(0);
      expect(map.coordsAtPos(1)).toBeNull();
    });
  });
});

describe("CharacterMap — posAbove / posBelow (vertical navigation)", () => {
  let map: CharacterMap;

  beforeEach(() => {
    map = new CharacterMap();
    buildTwoLinePage(map);
  });

  describe("posBelow", () => {
    it("returns a position on the next line", () => {
      // docPos 1 is on line 0 — posBelow should land somewhere on line 1
      const pos = map.posBelow(1, 0);
      expect(pos).not.toBeNull();
      expect(pos).toBeGreaterThanOrEqual(6);
      expect(pos).toBeLessThanOrEqual(11);
    });

    it("preserves x — same horizontal position on the line below", () => {
      // x=25 on line 0 is between glyph 2 (x=20) and glyph 3 (x=30)
      // posBelow should land near the same x on line 1
      const pos = map.posBelow(3, 25);
      expect(pos).not.toBeNull();
      // x=25 midpoint: glyph at x=20 has midpoint 25, so we land at docPos 8 (before glyph 3)
      expect(pos).toBeGreaterThanOrEqual(6);
    });

    it("returns null from the last line (no line below)", () => {
      // docPos 6 is on line 1 (the last line) — no line below
      const pos = map.posBelow(6, 0);
      expect(pos).toBeNull();
    });
  });

  describe("posAbove", () => {
    it("returns a position on the previous line", () => {
      // docPos 6 is on line 1 — posAbove should land somewhere on line 0
      const pos = map.posAbove(6, 0);
      expect(pos).not.toBeNull();
      expect(pos).toBeGreaterThanOrEqual(1);
      expect(pos).toBeLessThan(6);
    });

    it("preserves x — same horizontal position on the line above", () => {
      const pos = map.posAbove(8, 30); // x=30 on line 1, glyph 3
      expect(pos).not.toBeNull();
      expect(pos).toBeGreaterThanOrEqual(1);
      expect(pos).toBeLessThan(6);
    });

    it("returns null from the first line (no line above)", () => {
      // docPos 1 is on line 0 (lineIndex 0) — no line above on this page or previous
      const pos = map.posAbove(1, 0);
      expect(pos).toBeNull();
    });
  });

  describe("cross-page navigation", () => {
    it("posBelow crosses from last line of page 1 to first line of page 2", () => {
      const crossMap = new CharacterMap();
      // Page 1 has only one line (lineIndex 0)
      crossMap.registerGlyph({ docPos: 1, x: 0, y: 60, lineY: 60, width: 10, height: 20, page: 1, lineIndex: 0 });
      crossMap.registerLine({ page: 1, lineIndex: 0, y: 60, height: 20, x: 0, contentWidth: 400, startDocPos: 1, endDocPos: 2 });
      // Page 2 has its own line (lineIndex 0 — page-global within page 2)
      crossMap.registerGlyph({ docPos: 5, x: 0, y: 60, lineY: 60, width: 10, height: 20, page: 2, lineIndex: 0 });
      crossMap.registerLine({ page: 2, lineIndex: 0, y: 60, height: 20, x: 0, contentWidth: 400, startDocPos: 5, endDocPos: 6 });

      const pos = crossMap.posBelow(1, 0);
      expect(pos).toBeGreaterThanOrEqual(5);
    });

    it("posAbove crosses from first line of page 2 to last line of page 1", () => {
      const crossMap = new CharacterMap();
      crossMap.registerGlyph({ docPos: 1, x: 0, y: 60, lineY: 60, width: 10, height: 20, page: 1, lineIndex: 0 });
      crossMap.registerLine({ page: 1, lineIndex: 0, x: 0, contentWidth: 400, y: 60, height: 20, startDocPos: 1, endDocPos: 2 });
      crossMap.registerGlyph({ docPos: 5, x: 0, y: 60, lineY: 60, width: 10, height: 20, page: 2, lineIndex: 0 });
      crossMap.registerLine({ page: 2, lineIndex: 0, x: 0, contentWidth: 400, y: 60, height: 20, startDocPos: 5, endDocPos: 6 });

      const pos = crossMap.posAbove(5, 0);
      expect(pos).toBeGreaterThanOrEqual(1);
      expect(pos).toBeLessThan(5);
    });

    it("returns null when the adjacent page is not in the CharacterMap", () => {
      // Only page 1 is registered — no page 0 or page 2
      expect(map.posAbove(1, 0)).toBeNull();
      expect(map.posBelow(6, 0)).toBeNull();
    });
  });

  // ── lineStartPos / lineEndPos ───────────────────────────────────────────────

  describe("lineStartPos / lineEndPos", () => {
    it("lineStartPos returns the start of the line containing the position", () => {
      // Line 0: docPos 1-5, line 1: docPos 6-10
      expect(map.lineStartPos(3)).toBe(1);
      expect(map.lineStartPos(8)).toBe(6);
    });

    it("lineEndPos returns the end of the line containing the position", () => {
      expect(map.lineEndPos(3)).toBe(6);
      expect(map.lineEndPos(8)).toBe(11);
    });

    it("lineStartPos at line start returns the same position", () => {
      expect(map.lineStartPos(1)).toBe(1);
      expect(map.lineStartPos(6)).toBe(6);
    });

    it("lineEndPos at line start returns the end of that line", () => {
      // pos 6 is the start of line 1 (docPos 6-10), so lineEnd = 11
      expect(map.lineEndPos(6)).toBe(11);
    });

    it("lineStartPos of first glyph returns line start", () => {
      expect(map.lineStartPos(1)).toBe(1);
    });
  });
});
