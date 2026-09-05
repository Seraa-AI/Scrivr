import { describe, it, expect } from "vitest";
import { parseCssColor, toHex6 } from "./cssColor";

describe("parseCssColor", () => {
  it.each([
    ["#abc", { r: 170, g: 187, b: 204 }],
    ["#AABBCC", { r: 170, g: 187, b: 204 }],
    ["#eeeeee", { r: 238, g: 238, b: 238 }],
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3 }],
    ["rgb(1 2 3)", { r: 1, g: 2, b: 3 }],
    ["rgba(1, 2, 3, 0.5)", { r: 1, g: 2, b: 3 }],
    ["  rgb(238, 238, 238)  ", { r: 238, g: 238, b: 238 }],
  ])("reads %o", (value, expected) => {
    expect(parseCssColor(value)).toEqual(expected);
  });

  // A cell fill is painted onto the page; no output lane carries transparency.
  it.each([
    ["#abcd", { r: 170, g: 187, b: 204 }],
    ["#aabbccdd", { r: 170, g: 187, b: 204 }],
    ["rgb(1 2 3 / 50%)", { r: 1, g: 2, b: 3 }],
  ])("drops the alpha in %o", (value, expected) => {
    expect(parseCssColor(value)).toEqual(expected);
  });

  it("reads a percentage channel", () => {
    expect(parseCssColor("rgb(100%, 0%, 50%)")).toEqual({ r: 255, g: 0, b: 128 });
  });

  it("reads hsl", () => {
    expect(parseCssColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseCssColor("hsl(120, 100%, 50%)")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("clamps a channel outside the range", () => {
    expect(parseCssColor("rgb(300, -20, 3)")).toEqual({ r: 255, g: 0, b: 3 });
  });

  // A named colour is resolved by the browser before it reaches the model; a
  // lane that still sees one omits the fill rather than guessing at it.
  it.each(["rebeccapurple", "red", "", "not a colour", "url(x.png)", "#ab"])(
    "returns null for %o",
    (value) => {
      expect(parseCssColor(value)).toBeNull();
    },
  );
});

describe("toHex6", () => {
  it("writes the six digits a hex-only format wants", () => {
    expect(toHex6({ r: 238, g: 238, b: 238 })).toBe("eeeeee");
    expect(toHex6({ r: 1, g: 2, b: 3 })).toBe("010203");
  });

  it("round-trips through parseCssColor", () => {
    const colour = parseCssColor("rgb(18, 52, 86)");
    expect(colour).not.toBeNull();
    expect(toHex6(colour!)).toBe("123456");
  });
});
