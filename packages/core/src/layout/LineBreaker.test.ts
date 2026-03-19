import { describe, it, expect } from "vitest";

/**
 * LineBreaker unit tests.
 *
 * The line breaker is pure logic — given spans and a max width, it returns
 * lines. No canvas needed. These tests can run in Node environment.
 *
 * Replace the stub import once LineBreaker is built in Phase 1.
 */

interface Span {
  text: string;
  font: string;
  width: number; // pre-measured for test simplicity
}

interface Line {
  spans: Span[];
  width: number;
}

// Temporary stub — replace with: import { breakIntoLines } from "./LineBreaker";
function breakIntoLines(_spans: Span[], _maxWidth: number): Line[] {
  throw new Error("Not implemented yet — build LineBreaker in Phase 1");
}

// Helper: create a span where width = text.length * charWidth
function span(text: string, charWidth = 8): Span {
  return { text, font: "14px serif", width: text.length * charWidth };
}

describe("LineBreaker", () => {
  it("fits text that is shorter than max width on one line", () => {
    const spans = [span("Hello world")]; // 11 chars × 8px = 88px
    const lines = breakIntoLines(spans, 200);
    expect(lines).toHaveLength(1);
  });

  it("breaks text that exceeds max width onto a new line", () => {
    // Each word is 8 chars × 8px = 64px, 3 words = 192px > 100px limit
    const spans = [span("Hello world again")];
    const lines = breakIntoLines(spans, 100);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("does not exceed max width on any line", () => {
    const spans = [span("The quick brown fox jumps over the lazy dog")];
    const maxWidth = 120;
    const lines = breakIntoLines(spans, maxWidth);
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(maxWidth);
    }
  });

  it("preserves all text across lines — no words dropped", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const spans = [span(text)];
    const lines = breakIntoLines(spans, 100);
    const reconstructed = lines
      .flatMap((l) => l.spans.map((s) => s.text))
      .join("")
      .trim();
    expect(reconstructed).toBe(text);
  });

  it("handles multiple spans with different fonts on the same line", () => {
    const spans = [
      span("Hello ", 8),
      span("world", 10), // bold, wider chars
    ];
    // 6×8 + 5×10 = 48 + 50 = 98px — fits in 120px
    const lines = breakIntoLines(spans, 120);
    expect(lines).toHaveLength(1);
  });
});
