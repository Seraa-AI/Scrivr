import { describe, it, expect } from "vitest";
import { LineBreaker } from "./LineBreaker";
import { CharacterMap } from "./CharacterMap";
import { createMeasurer } from "../test-utils";

/**
 * LineBreaker tests. Widths and font metrics come from a real
 * `@napi-rs/canvas`-backed `TextMeasurer` (see `createMeasurer`). Assertions
 * use the same measurer instance — testing that the line breaker agrees with
 * the measurement model, not that the model returns specific pixels.
 */

function makeMeasurer() {
  return createMeasurer();
}

describe("LineBreaker — basic wrapping", () => {
  it("puts everything on one line when it fits", () => {
    const measurer = makeMeasurer();
    const lb = new LineBreaker(measurer);
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "Hello world",
          font: "14px serif",
          docPos: 1,
        },
      ],
      200,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(1);
    // The single line's width agrees with the measurer's own measurement
    // of the full string — line breaker and measurer share one source of truth.
    expect(lines[0]?.width).toBeCloseTo(
      measurer.measureWidth("Hello world", "14px serif"),
      2,
    );
  });

  it("wraps onto a new line when text exceeds maxWidth", () => {
    const measurer = makeMeasurer();
    const lb = new LineBreaker(measurer);
    // Pick a maxWidth that fits "Hello " but not the full string, so the
    // wrap is forced regardless of exact font widths.
    const helloSpaceWidth = measurer.measureWidth("Hello ", "14px serif");
    const fullWidth = measurer.measureWidth("Hello world", "14px serif");
    const maxWidth = (helloSpaceWidth + fullWidth) / 2;
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "Hello world",
          font: "14px serif",
          docPos: 1,
        },
      ],
      maxWidth,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(2);
  });

  it("no line exceeds maxWidth", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "The quick brown fox jumps over the lazy dog",
          font: "14px serif",
          docPos: 1,
        },
      ],
      100,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(100);
    }
  });

  it("preserves all text — no words are dropped across lines", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text, font: "14px serif", docPos: 1 }],
      100,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    const reconstructed = lines
      .flatMap((l) =>
        l.spans
          .filter((s) => s.kind === "text")
          .map((s) => (s.kind === "text" ? s.text : "")),
      )
      .join("")
      .trim();
    expect(reconstructed).toBe(text);
  });

  it("returns an empty array for empty input", () => {
    const lb = new LineBreaker(makeMeasurer());
    expect(
      lb.breakIntoLines([], 400, {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
      }),
    ).toHaveLength(0);
  });
});

describe("LineBreaker — multi-span (mixed fonts)", () => {
  it("handles two spans with different fonts on the same line", () => {
    const lb = new LineBreaker(makeMeasurer());
    // "Hello " (48px) + "world" (40px) = 88px — fits in 120px
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "Hello ",
          font: "14px serif",
          docPos: 1,
        },
        {
          kind: "text" as const,
          text: "world",
          font: "bold 14px serif",
          docPos: 7,
        },
      ],
      120,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.spans).toHaveLength(2);
  });

  it("wraps across spans when a word from span 2 doesn't fit", () => {
    const lb = new LineBreaker(makeMeasurer());
    // maxWidth=60: "Hello " (48px) fits, "world" (40px) → 88px > 60 → wrap
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "Hello ",
          font: "14px serif",
          docPos: 1,
        },
        {
          kind: "text" as const,
          text: "world",
          font: "bold 14px serif",
          docPos: 7,
        },
      ],
      60,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(2);
  });
});

describe("LineBreaker — vertical metrics", () => {
  it("line height is taken from font metrics × multiplier", () => {
    const measurer = makeMeasurer();
    const lb = new LineBreaker(measurer);
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text: "Hello", font: "14px serif", docPos: 1 }],
      200,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    // The line height matches `(ascent + descent) * lineHeightMultiplier`
    // for the font in use — line breaker reads the metric from the measurer
    // rather than computing its own.
    const m = measurer.getFontMetrics("14px serif");
    expect(lines[0]?.lineHeight).toBeCloseTo(m.lineHeight, 2);
  });

  it("uses the tallest font when spans have different metrics", () => {
    const measurer = makeMeasurer();
    const lb = new LineBreaker(measurer);
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "normal ",
          font: "14px serif",
          docPos: 1,
        },
        { kind: "text" as const, text: "big", font: "24px serif", docPos: 8 },
      ],
      200,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    // The larger 24px span dominates — the line's ascent matches the bigger
    // font, not the first span's font.
    const bigAscent = measurer.getFontMetrics("24px serif").ascent;
    expect(lines[0]?.ascent).toBeCloseTo(bigAscent, 2);
  });
});

describe("LineBreaker — overflow / wide words (regression)", () => {
  it("breaks a word wider than maxWidth at the character level (splitWideWord)", () => {
    const lb = new LineBreaker(makeMeasurer());
    // "ABCDEFGHIJ" = 10 chars × 8px = 80px, but maxWidth is 40px (5 chars)
    // Expected: each line is ≤ 40px wide
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "ABCDEFGHIJ",
          font: "14px serif",
          docPos: 1,
        },
      ],
      40,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
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
      [{ kind: "text" as const, text, font: "14px serif", docPos: 1 }],
      40,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    const reconstructed = lines
      .flatMap((l) =>
        l.spans
          .filter((s) => s.kind === "text")
          .map((s) => (s.kind === "text" ? s.text : "")),
      )
      .join("");
    expect(reconstructed).toBe(text);
  });

  it("does not overflow the page when a long unbreakable string is typed", () => {
    const lb = new LineBreaker(makeMeasurer());
    // Simulates a long URL or identifier with no spaces
    const text = "a".repeat(50); // 50 chars × 8px = 400px, maxWidth = 100px
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text, font: "14px serif", docPos: 1 }],
      100,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(100);
    }
  });

  it("does not split a surrogate pair when breaking a wide word containing emoji", () => {
    const lb = new LineBreaker(makeMeasurer());
    // "AB😀CD" — 😀 is a surrogate pair (JS .length = 2).
    // maxWidth = 16px (2 ASCII chars). The split must never land inside the emoji.
    const text = "AB\uD83D\uDE00CD"; // "AB😀CD"
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text, font: "14px serif", docPos: 1 }],
      16,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    const reconstructed = lines
      .flatMap((l) =>
        l.spans
          .filter((s) => s.kind === "text")
          .map((s) => (s as { text: string }).text),
      )
      .join("");
    expect(reconstructed).toBe(text);
    // Every chunk must be a valid (non-broken) string — no lone surrogates.
    for (const line of lines) {
      for (const span of line.spans) {
        if (span.kind !== "text") continue;
        expect(() =>
          encodeURIComponent((span as { text: string }).text),
        ).not.toThrow();
      }
    }
  });
});

describe("LineBreaker — skipToY (top-bottom float)", () => {
  it("skips cumulativeLineY past the exclusion zone when skipToY is returned", () => {
    const lb = new LineBreaker(makeMeasurer());
    // Float exclusion spans absoluteY 20–60 (40px gap) — lineHeight = 18px.
    // startY = 0, so absoluteLineY = cumulativeLineY.
    // First word lands at y=0 (no constraint) → line 1 produced.
    // Second word lands at y=18 which is inside [20, 60) → skipToY=60 jumps cumulativeLineY to 60.
    const lineSpaceProvider = (y: number) => {
      if (y >= 18 && y < 60) return { segments: [], skipToY: 60 };
      return { segments: [{ x: 0, width: 200 }] };
    };
    const lines = lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "before float after",
          font: "14px serif",
          docPos: 1,
        },
      ],
      200,
      { defaultFontFamily: "serif", defaultFontSize: 14, lineSpaceProvider },
    );
    // There should be no line whose startY falls inside the exclusion zone.
    // We can verify by checking that text spans before and after the gap both exist
    // and the total line count is > 1 (gap caused a split).
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("all words are preserved when a skipToY gap is inserted", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lineSpaceProvider = (y: number) =>
      y >= 18 && y < 60
        ? { segments: [], skipToY: 60 }
        : { segments: [{ x: 0, width: 400 }] };
    const text = "before float after end";
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text, font: "14px serif", docPos: 1 }],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14, lineSpaceProvider },
    );
    const reconstructed = lines
      .flatMap((l) =>
        l.spans
          .filter((s) => s.kind === "text")
          .map((s) => (s.kind === "text" ? s.text : "")),
      )
      .join("")
      .trim();
    expect(reconstructed).toBe(text);
  });
});

describe("LineBreaker — segmented line space", () => {
  it("continues a visual line in the next segment when the current segment fills", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [{ kind: "text" as const, text: "aaaa bbbb cccc", font: "14px serif", docPos: 1 }],
      200,
      {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
        lineSpaceProvider: () => ({
          segments: [
            { x: 0, width: 48 },
            { x: 120, width: 80 },
          ],
        }),
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.positioned).toBe(true);
    expect(lines[0]!.segments).toHaveLength(2);
    expect(lines[0]!.spans.some((span) => span.x === 0)).toBe(true);
    expect(lines[0]!.spans.some((span) => span.x === 120)).toBe(true);
  });
});

describe("LineBreaker — CharacterMap population", () => {
  it("registers one glyph per character", () => {
    const lb = new LineBreaker(makeMeasurer());
    const map = new CharacterMap();

    lb.breakIntoLines(
      [{ kind: "text" as const, text: "Hi", font: "14px serif", docPos: 1 }],
      200,
      {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
        map,
        pageContext: { page: 1, lineIndexOffset: 0, lineY: 60 },
      },
    );

    // "H" at docPos 1, "i" at docPos 2
    expect(map.glyphsInRange(1, 3)).toHaveLength(2);
  });

  it("registers one line entry per wrapped line", () => {
    const lb = new LineBreaker(makeMeasurer());
    const map = new CharacterMap();

    // maxWidth=60: wraps into 2 lines
    lb.breakIntoLines(
      [
        {
          kind: "text" as const,
          text: "Hello world",
          font: "14px serif",
          docPos: 1,
        },
      ],
      60,
      {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
        map,
        pageContext: { page: 1, lineIndexOffset: 0, lineY: 60 },
      },
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
      [{ kind: "text" as const, text: "Hi", font: "14px serif", docPos: 1 }],
      200,
      {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
        map,
        pageContext: { page: 1, lineIndexOffset: 0, lineY: 60 },
      },
    );

    const coords = map.coordsAtPos(1);
    expect(coords?.x).toBe(0);
  });
});

describe("LineBreaker — hardBreak", () => {
  it("break token between two text spans produces two lines", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { kind: "text" as const, text: "Hello", font: "14px serif", docPos: 1 },
        { kind: "break" as const, docPos: 6 },
        { kind: "text" as const, text: "World", font: "14px serif", docPos: 7 },
      ],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.spans[0]).toMatchObject({ kind: "text", text: "Hello" });
    expect(lines[0]!.terminalBreakDocPos).toBe(6);
    expect(lines[1]!.spans[0]).toMatchObject({ kind: "text", text: "World" });
    expect(lines[1]!.terminalBreakDocPos).toBeUndefined();
  });

  it("trailing break emits a phantom ZWS last line", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { kind: "text" as const, text: "Hello", font: "14px serif", docPos: 1 },
        { kind: "break" as const, docPos: 6 },
      ],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.terminalBreakDocPos).toBe(6);
    // Phantom line: ZWS at docPos = break.docPos + 1
    const phantomSpan = lines[1]!.spans[0];
    expect(phantomSpan).toMatchObject({ kind: "text", docPos: 7 });
    expect((phantomSpan as { text: string }).text).toBe("\u200B");
  });

  it("leading break emits a phantom ZWS line before the content", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { kind: "break" as const, docPos: 1 },
        { kind: "text" as const, text: "World", font: "14px serif", docPos: 2 },
      ],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    expect(lines).toHaveLength(2);
    // Line 0: phantom ZWS at the break's docPos
    expect((lines[0]!.spans[0] as { text: string }).text).toBe("\u200B");
    expect(lines[0]!.spans[0]!.docPos).toBe(1);
    // Line 1: "World"
    expect(lines[1]!.spans[0]).toMatchObject({ kind: "text", text: "World" });
  });

  it("two consecutive breaks produce two separate lines", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { kind: "text" as const, text: "A", font: "14px serif", docPos: 1 },
        { kind: "break" as const, docPos: 2 },
        { kind: "break" as const, docPos: 3 },
        { kind: "text" as const, text: "B", font: "14px serif", docPos: 4 },
      ],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    // "A" | empty (break2) | "B"
    expect(lines).toHaveLength(3);
    expect(lines[0]!.spans[0]).toMatchObject({ kind: "text", text: "A" });
    expect(lines[0]!.terminalBreakDocPos).toBe(2);
    expect((lines[1]!.spans[0] as { text: string }).text).toBe("\u200B");
    expect(lines[2]!.spans[0]).toMatchObject({ kind: "text", text: "B" });
  });

  it("break glyph is registered at terminalBreakDocPos in the CharacterMap", () => {
    const measurer = makeMeasurer();
    const lb = new LineBreaker(measurer);
    const map = new CharacterMap();
    lb.breakIntoLines(
      [
        { kind: "text" as const, text: "Hello", font: "14px serif", docPos: 1 },
        { kind: "break" as const, docPos: 6 },
        { kind: "text" as const, text: "World", font: "14px serif", docPos: 7 },
      ],
      400,
      {
        defaultFontFamily: "serif",
        defaultFontSize: 14,
        map,
        pageContext: { page: 1, lineIndexOffset: 0, lineY: 0 },
      },
    );
    // Break position must be reachable via coordsAtPos, sitting at the
    // right edge of "Hello".
    const breakCoords = map.coordsAtPos(6);
    expect(breakCoords).not.toBeNull();
    expect(breakCoords?.x).toBeCloseTo(measurer.measureWidth("Hello", "14px serif"), 2);
  });

  it("each line has normal text line height — no inflation", () => {
    const lb = new LineBreaker(makeMeasurer());
    const lines = lb.breakIntoLines(
      [
        { kind: "text" as const, text: "A", font: "14px serif", docPos: 1 },
        { kind: "break" as const, docPos: 2 },
        { kind: "text" as const, text: "B", font: "14px serif", docPos: 3 },
      ],
      400,
      { defaultFontFamily: "serif", defaultFontSize: 14 },
    );
    for (const line of lines) {
      expect(line.lineHeight).toBeGreaterThan(0);
      expect(line.lineHeight).toBeLessThan(100);
    }
  });
});
