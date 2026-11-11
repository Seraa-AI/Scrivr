/**
 * How a changed object is framed is decided by what the change did; an
 * operation a synced record names that tracking does not know frames nothing.
 */
import { describe, expect, it } from "vitest";
import { objectColor } from "../TrackChanges";

describe("the colour an object's change is framed in", () => {
  it("is set for the operations that frame an object", () => {
    for (const operation of ["insert", "move", "delete", "set_attrs"]) {
      expect(typeof objectColor(operation, "alice")).toBe("string");
    }
  });

  it("is none for an operation tracking does not know, including prototype names", () => {
    for (const operation of ["__proto__", "toString", "constructor", "", "bogus"]) {
      expect(objectColor(operation, "alice")).toBeUndefined();
    }
  });
});
