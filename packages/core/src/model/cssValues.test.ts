import { describe, it, expect } from "vitest";
import { cssLengthToPx, cssPrimaryFamily, htmlFontSizeToPx, parseTextAlign } from "./cssValues";

describe("cssLengthToPx", () => {
  it("converts absolute and font-relative units at 96dpi and 16px", () => {
    expect(cssLengthToPx("24px")).toBe(24);
    expect(cssLengthToPx("18pt")).toBe(24);
    expect(cssLengthToPx("0.5in")).toBe(48);
    expect(cssLengthToPx("1.5em", 16)).toBe(24);
    expect(cssLengthToPx("2rem", 10)).toBe(20);
    expect(cssLengthToPx("2.54cm")).toBeCloseTo(96);
    expect(cssLengthToPx("12")).toBe(12);
  });

  it("is null for what is not a length", () => {
    for (const value of ["", "50%", "auto", "large", "1vw", "px", ".", "1constructor", "1toString"]) {
      expect(cssLengthToPx(value)).toBeNull();
    }
  });

  it("leaves em and rem unresolved when the caller cannot know the font size", () => {
    expect(cssLengthToPx("2em")).toBeNull();
  });
});

describe("parseTextAlign", () => {
  it("maps logical and prefixed keywords onto the four, and nothing else", () => {
    expect(["start", "end", "JUSTIFY", "-webkit-center", "middle", "-webkit-auto", ""].map(parseTextAlign)).toEqual([
      "left",
      "right",
      "justify",
      "center",
      null,
      null,
      null,
    ]);
  });
});

describe("cssPrimaryFamily", () => {
  it("takes the first family of a stack, unquoted", () => {
    expect(cssPrimaryFamily(`"Times New Roman", serif`)).toBe("Times New Roman");
    expect(cssPrimaryFamily("")).toBeNull();
  });
});

describe("htmlFontSizeToPx", () => {
  it("reads 1–7 and steps relative to 3, clamped", () => {
    expect(["1", "3", "7", "+1", "-2", "9", "x"].map(htmlFontSizeToPx)).toEqual([10, 16, 48, 18, 10, 48, null]);
  });
});
