/**
 * The geometry of the formatting underline, and the barrel it ships through.
 *
 * `renderFormatHighlight` is the only genuinely new drawing in this lane, and
 * the decision it makes — which glyphs belong to one line — is not visible from
 * its output unless something records the strokes.
 */
import { describe, expect, it } from "vitest";
import type { GlyphEntry } from "@scrivr/core";
// Through the package barrel: a helper whose type or value is dropped from
// `index.ts` fails here rather than at a consumer.
import { renderFormatHighlight } from "../index";
import type { FormatRenderInstruction } from "../index";

/** Records the strokes a renderer asks for, so geometry can be asserted. */
function recordingContext() {
  const strokes: Array<{ from: [number, number]; to: [number, number] }> = [];
  let pending: [number, number] | null = null;
  const ctx = {
    save() {}, restore() {}, beginPath() { pending = null; },
    moveTo(x: number, y: number) { pending = [x, y]; },
    lineTo(x: number, y: number) { if (pending) strokes.push({ from: pending, to: [x, y] }); },
    stroke() {},
    strokeStyle: "", lineWidth: 0,
  };
  return { ctx, strokes };
}

const glyph = (x: number, lineY: number, y = lineY, height = 12): GlyphEntry => ({
  docPos: 0, x, y, lineY, width: 10, height, page: 0, lineIndex: 0,
});

describe("renderFormatHighlight", () => {
  it("draws one rule per line, not one across the gap between them", () => {
    const { ctx, strokes } = recordingContext();
    const glyphs = [glyph(0, 100), glyph(10, 100), glyph(0, 130), glyph(10, 130)];

    renderFormatHighlight(ctx as unknown as CanvasRenderingContext2D, glyphs, true);

    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.from[0]).toBe(0);
    expect(strokes[0]!.to[0]).toBe(20);
    expect(strokes[0]!.from[1]).not.toBe(strokes[1]!.from[1]);
  });

  it("keeps a run of mixed sizes on one line and rules it straight", () => {
    const { ctx, strokes } = recordingContext();
    // Same line; the smaller glyph sits lower and is shorter, so its `y`
    // differs while its `lineY` does not.
    const glyphs = [
      glyph(0, 100, 100, 14),
      glyph(10, 100, 104, 9),
      glyph(20, 100, 100, 14),
    ];

    renderFormatHighlight(ctx as unknown as CanvasRenderingContext2D, glyphs, false);

    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.from[1]).toBe(strokes[0]!.to[1]);
  });

  it("draws nothing for an empty run", () => {
    const { ctx, strokes } = recordingContext();
    renderFormatHighlight(ctx as unknown as CanvasRenderingContext2D, [], true);
    expect(strokes).toEqual([]);
  });
});

describe("the instruction type is nameable by a consumer", () => {
  it("narrows to the format arm", () => {
    const inst: FormatRenderInstruction = { type: "format", from: 1, to: 4, page: 0 };
    expect(inst.to - inst.from).toBe(3);
  });
});
