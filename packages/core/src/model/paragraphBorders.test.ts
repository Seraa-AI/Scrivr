import { describe, it, expect } from "vitest";
import {
  normalizeBorderSide,
  normalizeParagraphBorders,
  normalizeShading,
  mergeBorderSide,
  hasAnyBorders,
  serializeParagraphBorders,
  parseParagraphBordersAttr,
  outsideBorders,
  DEFAULT_PARAGRAPH_BORDER,
  type ParagraphBorders,
} from "./paragraphBorders";

describe("normalizeBorderSide", () => {
  it("accepts a well-formed side", () => {
    expect(
      normalizeBorderSide({ style: "single", width: 2, color: "#f00", space: 3 }),
    ).toEqual({ style: "single", width: 2, color: "#f00", space: 3 });
  });

  it("rejects an unknown style", () => {
    expect(normalizeBorderSide({ style: "wiggly", width: 1 })).toBeUndefined();
  });

  it("rejects non-objects", () => {
    expect(normalizeBorderSide(null)).toBeUndefined();
    expect(normalizeBorderSide("single")).toBeUndefined();
    expect(normalizeBorderSide(42)).toBeUndefined();
  });

  it("fills defaults for missing width/space/color and clamps negatives", () => {
    expect(normalizeBorderSide({ style: "single" })).toEqual({
      style: "single",
      width: 0,
      color: "#000000",
      space: 0,
    });
    expect(
      normalizeBorderSide({ style: "single", width: -5, space: -2 }),
    ).toMatchObject({ width: 0, space: 0 });
  });

  it("preserves shadow and sourceStyle only when valid", () => {
    expect(
      normalizeBorderSide({ style: "none", shadow: true, sourceStyle: "nil" }),
    ).toMatchObject({ shadow: true, sourceStyle: "nil" });
    expect(
      normalizeBorderSide({ style: "single", sourceStyle: "bogus" }),
    ).not.toHaveProperty("sourceStyle");
  });
});

describe("normalizeParagraphBorders", () => {
  it("keeps valid edges and drops invalid ones", () => {
    const b = normalizeParagraphBorders({
      top: { style: "single" },
      bottom: { style: "garbage" },
      left: null,
    });
    expect(b).not.toBeNull();
    expect(b!.top).toBeDefined();
    expect(b!.bottom).toBeUndefined();
    expect(b!.left).toBeUndefined();
  });

  it("returns null when nothing valid remains", () => {
    expect(normalizeParagraphBorders({ top: { style: "x" } })).toBeNull();
    expect(normalizeParagraphBorders({})).toBeNull();
    expect(normalizeParagraphBorders(null)).toBeNull();
  });

  it("keeps a between border even when its style is none (grouping signal)", () => {
    const b = normalizeParagraphBorders({ between: { style: "none" } });
    expect(b!.between).toMatchObject({ style: "none" });
    expect(hasAnyBorders(b!)).toBe(true);
  });
});

describe("mergeBorderSide", () => {
  it("sets one edge without disturbing others", () => {
    const start: ParagraphBorders = { left: DEFAULT_PARAGRAPH_BORDER };
    const next = mergeBorderSide(start, "bottom", DEFAULT_PARAGRAPH_BORDER);
    expect(next!.left).toBeDefined();
    expect(next!.bottom).toBeDefined();
  });

  it("clears one edge and collapses to null when empty", () => {
    const start: ParagraphBorders = { bottom: DEFAULT_PARAGRAPH_BORDER };
    expect(mergeBorderSide(start, "bottom", undefined)).toBeNull();
  });

  it("does not mutate the input", () => {
    const start: ParagraphBorders = { top: DEFAULT_PARAGRAPH_BORDER };
    mergeBorderSide(start, "bottom", DEFAULT_PARAGRAPH_BORDER);
    expect(start.bottom).toBeUndefined();
  });
});

describe("shading", () => {
  it("accepts a fill and rejects empties", () => {
    expect(normalizeShading({ fill: "#ff0" })).toEqual({ fill: "#ff0" });
    expect(normalizeShading({ fill: "" })).toBeNull();
    expect(normalizeShading(null)).toBeNull();
  });
});

describe("DOM round-trip", () => {
  it("serialize → parse preserves borders", () => {
    const b = outsideBorders();
    const round = parseParagraphBordersAttr(serializeParagraphBorders(b) ?? null);
    expect(round).toEqual(b);
  });

  it("serialize(null) is undefined; parse of junk is null", () => {
    expect(serializeParagraphBorders(null)).toBeUndefined();
    expect(parseParagraphBordersAttr("not json")).toBeNull();
    expect(parseParagraphBordersAttr(null)).toBeNull();
  });
});
