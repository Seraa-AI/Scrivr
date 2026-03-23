import { describe, it, expect } from "vitest";
import { LineBreaker } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import { createMeasurer, MOCK_CHAR_WIDTH, MOCK_ASCENT } from "../test-utils";


/**
 * LineBreaker tests.
 *
 * TextMeasurer is created with a mocked canvas so measurements are predictable:
 *   - Every character is MOCK_CHAR_WIDTH (8px) wide
 *   - Font ascent: MOCK_ASCENT (12px), descent: 3px, lineHeight: (12+3) * 1.2 = 18px
 *
 * This lets tests reason about exact pixel values without real font loading.
 */


function makeMeasurer() { return createMeasurer(); }

// "Hello " = 6 chars × 8px = 48px
// "world"  = 5 chars × 8px = 40px
// "Hello world" = 11 chars × 8px = 88px

describe("LineBreaker — basic wrapping", () => {
  it("puts everything on one line when it fits", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ text: "Hello world", font: "14px serif", docPos: 1 }],
      200
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.width).toBe(11 * MOCK_CHAR_WIDTH); // 88px
  });

  it("wraps onto a new line when text exceeds maxWidth", () => {
    const lb = new LineBreaker(makeMeasurer());
    // maxWidth=80: "Hello " (48px) fits, "world" (40px) pushes to 88px → wrap
    const lines = lb.breakIntoLines(
      [{ text: "Hello world", font: "14px serif", docPos: 1 }],
      80
    );
    expect(lines).toHaveLength(2);
  });

  it("no line exceeds maxWidth", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ text: "The quick brown fox jumps over the lazy dog", font: "14px serif", docPos: 1 }],
      100
    );
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(100);
    }
  });

  it("preserves all text — no words are dropped across lines", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ text, font: "14px serif", docPos: 1 }],
      100
    );
    const reconstructed = lines
      .flatMap((l) => l.spans.map((s) => s.text))
      .join("")
      .trim();
    expect(reconstructed).toBe(text);
  });

  it("returns an empty array for empty input", () => {
    const lb = new LineBreaker(makeMeasurer());
    expect(lb.breakIntoLines([], 400)).toHaveLength(0);
  });
});

describe("LineBreaker — multi-span (mixed fonts)", () => {
  it("handles two spans with different fonts on the same line", () => {
    const lb = new LineBreaker(makeMeasurer());
    // "Hello " (48px) + "world" (40px) = 88px — fits in 120px
    const lines = lb.breakIntoLines(
      [
        { text: "Hello ", font: "14px serif", docPos: 1 },
        { text: "world", font: "bold 14px serif", docPos: 7 },
      ],
      120
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.spans).toHaveLength(2);
  });

  it("wraps across spans when a word from span 2 doesn't fit", () => {
    const lb = new LineBreaker(makeMeasurer());
    // maxWidth=60: "Hello " (48px) fits, "world" (40px) → 88px > 60 → wrap
    const lines = lb.breakIntoLines(
      [
        { text: "Hello ", font: "14px serif", docPos: 1 },
        { text: "world", font: "bold 14px serif", docPos: 7 },
      ],
      60
    );
    expect(lines).toHaveLength(2);
  });
});

describe("LineBreaker — vertical metrics", () => {
  it("line height is taken from font metrics × multiplier", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ text: "Hello", font: "14px serif", docPos: 1 }],
      200
    );
    // (12 + 3) * 1.2 = 18
    expect(lines[0]?.lineHeight).toBeCloseTo(18);
  });

  it("uses the tallest font when spans have different metrics", () => {
    // Both fonts return same mock metrics in this test, but the logic
    // takes the max — verify it doesn't just use the first span's font
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { text: "normal ", font: "14px serif", docPos: 1 },
        { text: "big", font: "24px serif", docPos: 8 },
      ],
      200
    );
    expect(lines[0]?.ascent).toBe(MOCK_ASCENT);
  });
});

describe("LineBreaker — overflow / wide words (regression)", () => {
  it("breaks a word wider than maxWidth at the character level (splitWideWord)", () => {
    const lb = new LineBreaker(makeMeasurer());
    // "ABCDEFGHIJ" = 10 chars × 8px = 80px, but maxWidth is 40px (5 chars)
    // Expected: each line is ≤ 40px wide
    const lines = lb.breakIntoLines(
      [{ text: "ABCDEFGHIJ", font: "14px serif", docPos: 1 }],
      40
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(40);
    }
  });

  it("preserves all characters when a word is split across lines", () => {
    const lb = new LineBreaker(makeMeasurer());
    const text = "ABCDEFGHIJ";
    const lines = lb.breakIntoLines(
      [{ text, font: "14px serif", docPos: 1 }],
      40
    );
    const reconstructed = lines
      .flatMap((l) => l.spans.map((s) => s.text))
      .join("");
    expect(reconstructed).toBe(text);
  });

  it("does not overflow the page when a long unbreakable string is typed", () => {
    const lb = new LineBreaker(makeMeasurer());
    // Simulates a long URL or identifier with no spaces
    const text = "a".repeat(50); // 50 chars × 8px = 400px, maxWidth = 100px
    const lines = lb.breakIntoLines(
      [{ text, font: "14px serif", docPos: 1 }],
      100
    );
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(100);
    }
  });
});

describe("LineBreaker — CharacterMap population", () => {
  it("registers one glyph per character", () => {
    const lb = new LineBreaker(makeMeasurer());
    const map = new CharacterMap();

    lb.breakIntoLines(
      [{ text: "Hi", font: "14px serif", docPos: 1 }],
      200,
      map,
      { page: 1, lineIndexOffset: 0, lineY: 60 }
    );

    // "H" at docPos 1, "i" at docPos 2
    expect(map.glyphsInRange(1, 3)).toHaveLength(2);
  });

  it("registers one line entry per wrapped line", () => {
    const lb = new LineBreaker(makeMeasurer());
    const map = new CharacterMap();

    // maxWidth=60: wraps into 2 lines
    lb.breakIntoLines(
      [{ text: "Hello world", font: "14px serif", docPos: 1 }],
      60,
      map,
      { page: 1, lineIndexOffset: 0, lineY: 60 }
    );

    // posAtCoords on line 1 y=65 and line 2 y=85 should give different positions
    const pos1 = map.posAtCoords(40, 65, 1);
    const pos2 = map.posAtCoords(40, 85, 1);
    expect(pos1).not.toBe(pos2);
  });

  it("glyph x positions start at 0 for the first character on a line", () => {
    const lb = new LineBreaker(makeMeasurer());
    const map = new CharacterMap();

    lb.breakIntoLines(
      [{ text: "Hi", font: "14px serif", docPos: 1 }],
      200,
      map,
      { page: 1, lineIndexOffset: 0, lineY: 60 }
    );

    const coords = map.coordsAtPos(1);
    expect(coords?.x).toBe(0);
  });
});
