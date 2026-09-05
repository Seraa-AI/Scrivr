import { describe, it, expect } from "vitest";
import { compositeColor, parseCssColor, toHex6 } from "./cssColor";

describe("parseCssColor", () => {
  it.each([
    ["#abc", { r: 170, g: 187, b: 204, alpha: 1 }],
    ["#AABBCC", { r: 170, g: 187, b: 204, alpha: 1 }],
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3, alpha: 1 }],
    ["rgb(1 2 3)", { r: 1, g: 2, b: 3, alpha: 1 }],
    ["rgba(1, 2, 3, 0.5)", { r: 1, g: 2, b: 3, alpha: 0.5 }],
    ["rgb(1 2 3 / 50%)", { r: 1, g: 2, b: 3, alpha: 0.5 }],
    ["#abcd", { r: 170, g: 187, b: 204, alpha: 221 / 255 }],
    ["#aabbccdd", { r: 170, g: 187, b: 204, alpha: 221 / 255 }],
    [" RED ", { r: 255, g: 0, b: 0, alpha: 1 }],
    ["rebeccapurple", { r: 102, g: 51, b: 153, alpha: 1 }],
    ["transparent", { r: 0, g: 0, b: 0, alpha: 0 }],
    ["rgb(300, -20, 3)", { r: 255, g: 0, b: 3, alpha: 1 }],
    ["hsl(120, 100%, 50%)", { r: 0, g: 255, b: 0, alpha: 1 }],
    ["hsl(1e308turn 100% 50%)", { r: 255, g: 0, b: 0, alpha: 1 }],
    ["hsl(.5turn 100% 50% / 25%)", { r: 0, g: 255, b: 255, alpha: 0.25 }],
  ])("resolves %o without losing opacity", (value, expected) => {
    expect(parseCssColor(value)).toEqual(expected);
  });

  it("retains channel precision until output quantization", () => {
    const color = parseCssColor("rgb(100% 0% 50%)")!;
    expect(color.b).toBe(127.5);
    expect(toHex6({ r: color.r, g: color.g, b: color.b })).toBe("ff0080");
  });

  // s and l may be bare numbers in CSS Color 4, and a hand-authored or
  // server-side value never passes through a browser to be normalised.
  it.each([
    ["hsl(120 100 50)", { r: 0, g: 255, b: 0, alpha: 1 }],
    ["hsl(120, 100%, 50%)", { r: 0, g: 255, b: 0, alpha: 1 }],
  ])("reads %o with either spelling of saturation and lightness", (value, expected) => {
    expect(parseCssColor(value)).toEqual(expected);
  });

  it.each(["", "hotpinkish", "constructor", "url(x)", "var(--fill)", "currentcolor", "#ab",
    "rgb(1x 2 3)", "rgb(1 2 3 / nope)", "rgb(1,2,3,4,5)", "rgb(1,2,3 / .5)",
    "hsl(1oops 100% 50%)", "rgba(1,2,3,)"])("rejects %o", (value) => {
    expect(parseCssColor(value)).toBeNull();
  });
});

describe("opaque color output", () => {
  it("composites translucent black onto white for formats without alpha", () => {
    expect(toHex6(compositeColor(parseCssColor("rgba(0,0,0,.5)")!, { r: 255, g: 255, b: 255 }))).toBe("808080");
  });

  it("uses the supplied background instead of discarding transparency", () => {
    expect(compositeColor(parseCssColor("#0000")!, { r: 10, g: 20, b: 30 })).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("writes six hex digits", () => {
    expect(toHex6({ r: 1, g: 2, b: 3 })).toBe("010203");
  });
});
