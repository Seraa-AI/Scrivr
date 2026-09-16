/**
 * How much a renderer alters a face it was given for one it was asked for.
 *
 * Both lanes read these numbers, so they are the reason a faked bold looks the
 * same on screen and in an exported file. If they drifted apart the two would
 * disagree about the page while both believing they had synthesized it.
 */

import { describe, it, expect } from "vitest";
import { SYNTHETIC_ITALIC_SHEAR, emboldenWidth, fontSizeOf } from "./synthesis";

describe("standing in for a weight", () => {
  it("does nothing when the face already has it", () => {
    expect(emboldenWidth(undefined, 16)).toBe(0);
    expect(emboldenWidth({ style: { from: "normal", to: "italic" } }, 16)).toBe(0);
  });

  it("does nothing when the face is heavier than the request", () => {
    // A 700 standing in for a 400 is already too dark; thickening it further
    // would be the wrong direction, and thinning is not something a stroke
    // can do.
    expect(emboldenWidth({ weight: { from: 700, to: 400 } }, 16)).toBe(0);
  });

  it("scales with how far the face falls short", () => {
    const toSemibold = emboldenWidth({ weight: { from: 400, to: 600 } }, 16);
    const toBold = emboldenWidth({ weight: { from: 400, to: 700 } }, 16);

    expect(toSemibold).toBeGreaterThan(0);
    expect(toSemibold).toBeLessThan(toBold);
  });

  it("scales with the size, so one rule serves every heading", () => {
    const gap = { weight: { from: 400, to: 700 } };

    expect(emboldenWidth(gap, 32)).toBeCloseTo(emboldenWidth(gap, 16) * 2, 10);
  });

  it("stops thickening past the point a counter would fill in", () => {
    const bold = emboldenWidth({ weight: { from: 400, to: 700 } }, 16);
    const absurd = emboldenWidth({ weight: { from: 100, to: 950 } }, 16);

    expect(absurd).toBeLessThan(bold * 2);
  });
});

describe("standing in for a slant", () => {
  it("leans by about twelve degrees, as a designed italic does", () => {
    expect(Math.atan(SYNTHETIC_ITALIC_SHEAR) * (180 / Math.PI)).toBeCloseTo(12, 0);
  });
});

describe("reading a size out of a CSS shorthand", () => {
  it("finds it wherever the shorthand puts it", () => {
    expect(fontSizeOf("14px Inter")).toBe(14);
    expect(fontSizeOf("italic 700 27.5px Inter")).toBe(27.5);
  });

  it("falls back rather than returning NaN", () => {
    expect(fontSizeOf("Inter")).toBe(14);
  });
});
