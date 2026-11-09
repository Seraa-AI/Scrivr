import { describe, expect, it } from "vitest";
import { changedAttrKeys, describeAttrChanges } from "../attrChanges";

describe("how an attribute change reads", () => {
  it("names each changed attribute with its old and new value", () => {
    expect(describeAttrChanges({ level: 1, align: "left" }, { level: 2, align: "center" }))
      .toBe("Heading level: Heading 1 → Heading 2 · Alignment: Left → Center");
  });

  it("spells out a value that is an object, never as [object Object]", () => {
    const text = describeAttrChanges({ yOffset: 0, floatOffset: { x: 0, y: 0 } }, { yOffset: 48, floatOffset: { x: 0, y: 48 } });
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("x 0, y 48");
  });

  it("leaves out an attribute whose value is equal, though a different object", () => {
    expect(describeAttrChanges({ floatOffset: { x: 0, y: 0 }, level: 1 }, { floatOffset: { x: 0, y: 0 }, level: 2 }))
      .toBe("Heading level: Heading 1 → Heading 2");
  });

  it("names a list item's indent", () => {
    expect(describeAttrChanges({ levelOffset: 0 }, { levelOffset: 1 })).toBe("List indent: 0 → 1");
  });

  it("leaves out ids and tracking records", () => {
    expect(describeAttrChanges({ nodeId: "a", dataTracked: [] }, { nodeId: "b", dataTracked: [{}] })).toBe("");
  });
});

describe("which attributes changed", () => {
  it("counts a missing value as null, as a reviewer reads both", () => {
    expect(changedAttrKeys({ yOffset: 0 }, { yOffset: 48, x: null })).toEqual(["yOffset"]);
  });
});
