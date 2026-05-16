import { describe, it, expect, vi } from "vitest";
import { TextMeasurer, type TextMeasureContext } from "./TextMeasurer";
import { createNapiCanvasContext } from "../test/createNapiCanvasContext";

/**
 * TextMeasurer tests — exercise caching, font-metric stability, and
 * invalidation against the real `@napi-rs/canvas` (Skia) backend injected
 * via the DI seam. Widths and font metrics come from real Skia; the tests
 * assert relative behaviour (caching, proportionality, multipliers) so the
 * suite stays stable under font / glyph differences.
 *
 * Real measurement fidelity is validated visually in the demo app.
 */

/**
 * Build a measurer wired to a real Skia ctx with a spy on `measureText` so
 * cache-hit assertions can count calls. The spy calls through — measurements
 * stay real.
 */
function makeRealMeasurer(opts: { lineHeightMultiplier?: number } = {}) {
  const ctx = createNapiCanvasContext();
  const measureSpy = vi.spyOn(ctx, "measureText");
  return {
    m: new TextMeasurer({ ...opts, context: ctx }),
    measureSpy,
  };
}

describe("TextMeasurer.measureWidth", () => {
  it("returns a positive width proportional to text length", () => {
    const { m } = makeRealMeasurer();
    const w1 = m.measureWidth("hello", "14px serif");
    const w2 = m.measureWidth("hellohello", "14px serif");
    expect(w1).toBeGreaterThan(0);
    expect(w2).toBeGreaterThan(w1);
  });

  it("caches — measureText is not called twice for the same input", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "14px serif");
    expect(measureSpy).toHaveBeenCalledTimes(1);
  });

  it("treats different fonts as separate cache keys", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    expect(measureSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT trim text — trailing space is part of the measurement", () => {
    const { m } = makeRealMeasurer();
    const withSpace = m.measureWidth("word ", "14px serif");
    const withoutSpace = m.measureWidth("word", "14px serif");
    expect(withSpace).toBeGreaterThan(withoutSpace);
  });
});

describe("TextMeasurer.getFontMetrics", () => {
  it("returns positive ascent and descent", () => {
    const { m } = makeRealMeasurer();
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.ascent).toBeGreaterThan(0);
    expect(metrics.descent).toBeGreaterThan(0);
  });

  it("lineHeight includes the multiplier", () => {
    const { m: base } = makeRealMeasurer({ lineHeightMultiplier: 1.0 });
    const { m: scaled } = makeRealMeasurer({ lineHeightMultiplier: 1.5 });
    const baseLh = base.getFontMetrics("14px serif").lineHeight;
    const scaledLh = scaled.getFontMetrics("14px serif").lineHeight;
    expect(scaledLh).toBeCloseTo(baseLh * 1.5);
  });

  it("defaults lineHeightMultiplier to 1.2", () => {
    const { m: base } = makeRealMeasurer({ lineHeightMultiplier: 1.0 });
    const { m: defaulted } = makeRealMeasurer();
    const baseLh = base.getFontMetrics("14px serif").lineHeight;
    const defaultLh = defaulted.getFontMetrics("14px serif").lineHeight;
    expect(defaultLh).toBeCloseTo(baseLh * 1.2);
  });

  it("caches — measureText calls don't increase on repeated calls for the same font", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.getFontMetrics("14px serif");
    const callsAfterFirst = measureSpy.mock.calls.length;
    m.getFontMetrics("14px serif");
    // Second call must not add any more measureText calls (result is cached).
    expect(measureSpy).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("font metrics are stable — same result regardless of what text is measured after", () => {
    const { m } = makeRealMeasurer();
    const before = m.getFontMetrics("14px serif");
    m.measureWidth("Agpyjq", "14px serif"); // different chars, different actual bounds
    const after = m.getFontMetrics("14px serif");
    expect(before.ascent).toBe(after.ascent);
    expect(before.lineHeight).toBe(after.lineHeight);
  });

  it("falls back to actualBoundingBox when fontBoundingBox is absent", () => {
    // Tight mock for the legacy-browser branch — real Skia always reports
    // fontBoundingBox, so this is the one path we can't exercise with the
    // real backend. The `as TextMetrics` cast lets the fixture omit
    // fontBoundingBoxAscent/Descent the way pre-2023 Safari did at runtime,
    // even though the DOM type declares them as non-optional `number`.
    const ctx: TextMeasureContext = {
      font: "",
      measureText: vi.fn((_text: string): TextMetrics => ({
        width: 40,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
      } as TextMetrics)),
    };
    const m = new TextMeasurer({ lineHeightMultiplier: 1.0, context: ctx });
    const metrics = m.getFontMetrics("14px serif");
    expect(metrics.ascent).toBe(10);
    expect(metrics.descent).toBe(2);
    expect(metrics.lineHeight).toBeCloseTo(12);
  });
});

describe("TextMeasurer.measureRun", () => {
  it("returns totalWidth equal to measureWidth for the full string", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.totalWidth).toBe(m.measureWidth("hello", "14px serif"));
  });

  it("charPositions has the same length as the text", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.charPositions).toHaveLength(5);
  });

  it("first charPosition is always 0", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("hello", "14px serif");
    expect(run.charPositions[0]).toBe(0);
  });

  it("charPositions are strictly increasing", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("hello", "14px serif");
    for (let i = 1; i < run.charPositions.length; i++) {
      expect(run.charPositions[i]).toBeGreaterThan(run.charPositions[i - 1]!);
    }
  });

  it("returns empty arrays for empty string", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("", "14px serif");
    expect(run.totalWidth).toBe(0);
    expect(run.charPositions).toHaveLength(0);
  });

  it("single character — charPositions is [0] and totalWidth matches measureWidth", () => {
    const { m } = makeRealMeasurer();
    const run = m.measureRun("A", "14px serif");
    expect(run.charPositions).toEqual([0]);
    expect(run.totalWidth).toBe(m.measureWidth("A", "14px serif"));
  });

  it("caches — measureText is not called again for the same (font, text)", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureRun("hello", "14px serif");
    const callsAfterFirst = measureSpy.mock.calls.length;

    m.measureRun("hello", "14px serif"); // should be a cache hit
    expect(measureSpy.mock.calls.length).toBe(callsAfterFirst); // no new calls
  });

  it("different fonts are cached as separate entries", () => {
    const { m, measureSpy } = makeRealMeasurer();

    m.measureRun("hi", "14px serif");
    const callsAfterFirst = measureSpy.mock.calls.length;

    // Same text, different font — must NOT be a cache hit
    m.measureRun("hi", "16px serif");
    expect(measureSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("LRU runCache eviction", () => {
  it("evicts oldest entries when capacity is exceeded", () => {
    const { m } = makeRealMeasurer();
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
    const { m, measureSpy } = makeRealMeasurer();
    m.measureWidth("hello", "14px serif");
    const callsAfterFirst = measureSpy.mock.calls.length;
    m.invalidate("14px serif");
    m.measureWidth("hello", "14px serif");
    expect(measureSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("invalidating all clears every font cache", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    const callsAfterInitial = measureSpy.mock.calls.length;
    m.invalidate();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");
    // Both fonts had to re-measure after the global flush.
    expect(measureSpy.mock.calls.length).toBeGreaterThan(callsAfterInitial);
    expect(measureSpy.mock.calls.length - callsAfterInitial).toBe(
      callsAfterInitial,
    );
  });

  it("does not affect other fonts when invalidating one", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureWidth("hello", "14px serif");
    m.measureWidth("hello", "16px serif");

    const callsAfterInitial = measureSpy.mock.calls.length;

    m.invalidate("14px serif");
    m.measureWidth("hello", "16px serif"); // cache intact — no new call
    expect(measureSpy).toHaveBeenCalledTimes(callsAfterInitial); // unchanged

    m.measureWidth("hello", "14px serif"); // invalidated — must re-measure
    expect(measureSpy).toHaveBeenCalledTimes(callsAfterInitial + 1);
  });

  it("invalidate(font) evicts only that font's run-cache entries, not others", () => {
    const { m, measureSpy } = makeRealMeasurer();
    m.measureRun("hello", "14px serif");
    m.measureRun("hello", "16px serif"); // different font — should survive invalidation

    const callsBefore = measureSpy.mock.calls.length;

    m.invalidate("14px serif");

    // "16px serif" run should still be cached — no new measureText calls
    m.measureRun("hello", "16px serif");
    expect(measureSpy.mock.calls.length).toBe(callsBefore);

    // "14px serif" run was evicted — must re-measure
    m.measureRun("hello", "14px serif");
    expect(measureSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
