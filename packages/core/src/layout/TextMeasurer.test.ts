import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextMeasurer } from "./TextMeasurer";

/**
 * TextMeasurer tests.
 *
 * happy-dom provides a canvas with measureText() — but it returns zeroed
 * metrics. We mock it with predictable values so tests assert our caching
 * and logic, not browser measurement fidelity.
 *
 * Real measurement fidelity is validated visually in the demo app.
 */

const MOCK_CHAR_WIDTH = 8; // px per character
const MOCK_FONT_ASCENT = 12;
const MOCK_FONT_DESCENT = 3;

function mockMeasureText(text: string) {
  return {
    width: text.length * MOCK_CHAR_WIDTH,
    actualBoundingBoxAscent: MOCK_FONT_ASCENT,
    actualBoundingBoxDescent: MOCK_FONT_DESCENT,
    fontBoundingBoxAscent: MOCK_FONT_ASCENT,
    fontBoundingBoxDescent: MOCK_FONT_DESCENT,
  };
}

beforeEach(() => {
  // happy-dom doesn't implement OffscreenCanvas — TextMeasurer falls back to
  // HTMLCanvasElement. Mock that fallback path.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn(mockMeasureText),
    font: "",
  } as unknown as CanvasRenderingContext2D);
});

describe("TextMeasurer.measureWidth", () => {
  it("returns width proportional to text length", () => {
    const m = new TextMeasurer();
    expect(m.measureWidth("hello", "14px serif")).toBe(5 * MOCK_CHAR_WIDTH);
  });

  it("caches — measureText is not called twice for the same input", () => {
    const m = new TextMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "14px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
  });

  it("treats different fonts as separate cache keys", () => {
    const m = new TextMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it("does NOT trim text — trailing space is part of the measurement", () => {
    const m = new TextMeasurer();
    const withSpace = m.measureWidth("word ", "14px serif");
    const withoutSpace = m.measureWidth("word", "14px serif");
    expect(withSpace).toBeGreaterThan(withoutSpace);
  });
});

describe("TextMeasurer.getFontMetrics", () => {
  it("returns ascent and descent", () => {
    const m = new TextMeasurer();
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.ascent).toBe(MOCK_FONT_ASCENT);
    expect(metrics.descent).toBe(MOCK_FONT_DESCENT);
  });

  it("lineHeight includes the multiplier", () => {
    const m = new TextMeasurer({ lineHeightMultiplier: 1.5 });
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.lineHeight).toBeCloseTo((MOCK_FONT_ASCENT + MOCK_FONT_DESCENT) * 1.5);
  });

  it("defaults lineHeightMultiplier to 1.2", () => {
    const m = new TextMeasurer();
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.lineHeight).toBeCloseTo((MOCK_FONT_ASCENT + MOCK_FONT_DESCENT) * 1.2);
  });

  it("caches — measureText calls don't increase on repeated calls for the same font", () => {
    const m = new TextMeasurer();
    m.getFontMetrics("14px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    const callsAfterFirst = ctx.measureText.mock.calls.length;
    m.getFontMetrics("14px serif");
    // Second call must not add any more measureText calls (result is cached).
    expect(ctx.measureText).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("font metrics are stable — same result regardless of what text is measured after", () => {
    const m = new TextMeasurer();
    const before = m.getFontMetrics("14px serif");
    m.measureWidth("Agpyjq", "14px serif"); // different chars, different actual bounds
    const after = m.getFontMetrics("14px serif");
    expect(before.ascent).toBe(after.ascent);
    expect(before.lineHeight).toBe(after.lineHeight);
  });

  it("falls back to actualBoundingBox when fontBoundingBox is absent", () => {
    // Override mock to omit fontBoundingBoxAscent/Descent (older browser simulation)
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: vi.fn((_text: string) => ({
        width: 40,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
        // fontBoundingBoxAscent / fontBoundingBoxDescent intentionally absent
      })),
      font: "",
    } as unknown as CanvasRenderingContext2D);

    const m = new TextMeasurer({ lineHeightMultiplier: 1.0 });
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.ascent).toBe(10);
    expect(metrics.descent).toBe(2);
    expect(metrics.lineHeight).toBeCloseTo(12);
  });
});

describe("TextMeasurer.measureRun", () => {
  it("returns totalWidth equal to measureWidth for the full string", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.totalWidth).toBe(m.measureWidth("hello", "14px serif"));
  });

  it("charPositions has the same length as the text", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.charPositions).toHaveLength(5);
  });

  it("first charPosition is always 0", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.charPositions[0]).toBe(0);
  });

  it("charPositions are strictly increasing", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("hello", "14px serif");
    for (let i = 1; i < run.charPositions.length; i++) {
      expect(run.charPositions[i]).toBeGreaterThan(run.charPositions[i - 1]!);
    }
  });

  it("returns empty arrays for empty string", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("", "14px serif");
    expect(run.totalWidth).toBe(0);
    expect(run.charPositions).toHaveLength(0);
  });

  it("single character — charPositions is [0] and totalWidth matches measureWidth", () => {
    const m = new TextMeasurer();
    const run = m.measureRun("A", "14px serif");
    expect(run.charPositions).toEqual([0]);
    expect(run.totalWidth).toBe(m.measureWidth("A", "14px serif"));
  });

  it("caches — measureText is not called again for the same (font, text)", () => {
    const m = new TextMeasurer();
    m.measureRun("hello", "14px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    const callsAfterFirst = ctx.measureText.mock.calls.length;

    m.measureRun("hello", "14px serif"); // should be a cache hit
    expect(ctx.measureText.mock.calls.length).toBe(callsAfterFirst); // no new calls
  });

  it("different fonts are cached as separate entries", () => {
    const m = new TextMeasurer();
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };

    m.measureRun("hi", "14px serif");
    const callsAfterFirst = ctx.measureText.mock.calls.length;

    // Same text, different font — must NOT be a cache hit
    m.measureRun("hi", "16px serif");
    expect(ctx.measureText.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("LRU runCache eviction", () => {
  it("evicts oldest entries when capacity is exceeded", () => {
    const m = new TextMeasurer();
    const font = "14px serif";
    // Fill beyond the 2000-entry limit
    for (let i = 0; i < 2100; i++) {
      m.measureRun(`unique-text-${i}`, font);
    }
    // Oldest 100 entries (0–99) should have been evicted; cache size ≤ 2000
    const cache = m["runCache"] as { size: number };
    expect(cache.size).toBeLessThanOrEqual(2000);
  });
});

describe("TextMeasurer.invalidate", () => {
  it("invalidating a specific font causes re-measurement", () => {
    const m = new TextMeasurer();
    m.measureWidth("hello", "14px serif");
    m.invalidate("14px serif");
    m.measureWidth("hello", "14px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it("invalidating all clears every font cache", () => {
    const m = new TextMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    m.invalidate();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    expect(ctx.measureText).toHaveBeenCalledTimes(4);
  });

  it("does not affect other fonts when invalidating one", () => {
    const m = new TextMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");

    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    const callsAfterInitial = ctx.measureText.mock.calls.length;

    m.invalidate("14px serif");
    m.measureWidth("hello", "16px serif"); // cache intact — no new call
    expect(ctx.measureText).toHaveBeenCalledTimes(callsAfterInitial); // unchanged

    m.measureWidth("hello", "14px serif"); // invalidated — must re-measure
    expect(ctx.measureText).toHaveBeenCalledTimes(callsAfterInitial + 1);
  });

  it("invalidate(font) evicts only that font's run-cache entries, not others", () => {
    const m = new TextMeasurer();
    m.measureRun("hello", "14px serif");
    m.measureRun("hello", "16px serif"); // different font — should survive invalidation

    const ctx = m["ctx"] as unknown as { measureText: ReturnType<typeof vi.fn> };
    const callsBefore = ctx.measureText.mock.calls.length;

    m.invalidate("14px serif");

    // "16px serif" run should still be cached — no new measureText calls
    m.measureRun("hello", "16px serif");
    expect(ctx.measureText.mock.calls.length).toBe(callsBefore);

    // "14px serif" run was evicted — must re-measure
    m.measureRun("hello", "14px serif");
    expect(ctx.measureText.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
