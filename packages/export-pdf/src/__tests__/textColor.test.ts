import { describe, it, expect } from "vitest";
import { parseCssColor } from "../context";

// A `color` mark stores the literal its source declared — a paste from a page
// styled `color: red` keeps `red`, and Chrome hands back `rgb(255, 0, 0)`.
// Reading only hex used to produce NaN channels here, which pdf-lib throws on.
describe("text colour reaches the page", () => {
  it.each([
    ["red", { red: 1, green: 0, blue: 0 }],
    ["#ff0000", { red: 1, green: 0, blue: 0 }],
    ["rgb(255, 0, 0)", { red: 1, green: 0, blue: 0 }],
    ["rgb(255 0 0)", { red: 1, green: 0, blue: 0 }],
    ["rebeccapurple", { red: 102 / 255, green: 51 / 255, blue: 153 / 255 }],
  ])("resolves %o", (value, expected) => {
    expect(parseCssColor(value)).toMatchObject(expected);
  });

  it("never yields a NaN channel", () => {
    for (const value of ["red", "notacolour", "", "rgb(", "#ab"]) {
      const colour = parseCssColor(value);
      expect(Number.isFinite(colour.red)).toBe(true);
      expect(Number.isFinite(colour.green)).toBe(true);
      expect(Number.isFinite(colour.blue)).toBe(true);
    }
  });
});
