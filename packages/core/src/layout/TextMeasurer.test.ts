import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * TextMeasurer unit tests.
 *
 * canvas.measureText() is mocked here — happy-dom provides a canvas
 * implementation but its text metrics are zeroed out. We mock it explicitly
 * so tests assert our caching + logic, not browser measurement fidelity.
 * Real measurement fidelity is validated manually in the demo app.
 */

// Stub type until the real class is built
interface TextMeasurer {
  measure(text: string, font: string): { width: number; ascent: number; descent: number };
}

// Temporary factory — replace with real import once built:
// import { TextMeasurer } from "./TextMeasurer";
function createTextMeasurer(): TextMeasurer {
  throw new Error("Not implemented yet — build TextMeasurer in Phase 1");
}

describe("TextMeasurer", () => {
  beforeEach(() => {
    // Mock canvas measureText to return predictable values
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: vi.fn((text: string) => ({
        width: text.length * 8, // 8px per character (predictable for tests)
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
      })),
    } as unknown as CanvasRenderingContext2D);
  });

  it("measures text width based on font and content", () => {
    const measurer = createTextMeasurer();
    const result = measurer.measure("hello", "14px serif");
    expect(result.width).toBe(40); // 5 chars × 8px
  });

  it("returns ascent and descent", () => {
    const measurer = createTextMeasurer();
    const result = measurer.measure("hello", "14px serif");
    expect(result.ascent).toBe(12);
    expect(result.descent).toBe(3);
  });

  it("caches results — measureText is not called twice for the same input", () => {
    const measurer = createTextMeasurer();
    measurer.measure("hello", "14px serif");
    measurer.measure("hello", "14px serif");

    const ctx = HTMLCanvasElement.prototype.getContext("2d") as CanvasRenderingContext2D;
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
  });

  it("treats different fonts as different cache keys", () => {
    const measurer = createTextMeasurer();
    measurer.measure("hello", "14px serif");
    measurer.measure("hello", "16px serif");

    const ctx = HTMLCanvasElement.prototype.getContext("2d") as CanvasRenderingContext2D;
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });
});
