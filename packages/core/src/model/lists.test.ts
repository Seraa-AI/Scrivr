import { describe, expect, it } from "vitest";
import { buildStarterKitContext } from "../test-utils";
import { bulletShape, isListType, LIST_LEVELS, listKind, listLevel, listMarker, listStart } from "./lists";

const { schema } = buildStarterKitContext();
const item = schema.nodes["listItem"]?.create(null, schema.node("paragraph"));

describe("what is a list", () => {
  it("is a node whose items are list items", () => {
    const isList = (name: string) => {
      const type = schema.nodes[name];
      return type !== undefined && isListType(type);
    };
    expect(["bulletList", "orderedList"].map(isList)).toEqual([true, true]);
    expect(["listItem", "paragraph", "doc"].map(isList)).toEqual([false, false, false]);
  });

  it("names its kind", () => {
    expect(listKind(schema.node("bulletList", null, item))).toBe("bullet");
    expect(listKind(schema.node("orderedList", null, item))).toBe("ordered");
    expect(listKind(schema.node("paragraph"))).toBeNull();
  });

  it("starts an ordered list at its order", () => {
    expect(listStart(schema.node("orderedList", { order: 3 }, item))).toBe(3);
    expect(listStart(schema.node("bulletList", null, item))).toBe(1);
  });
});

describe("the level table", () => {
  it("has Word's nine levels", () => {
    expect(LIST_LEVELS).toHaveLength(9);
  });

  it("indents each level the same step past the one above", () => {
    const steps = LIST_LEVELS.slice(1).map((level, i) => level.textIndent - (LIST_LEVELS[i]?.textIndent ?? 0));
    expect(new Set(steps).size).toBe(1);
    expect(listLevel(0).textIndent).toBe(steps[0]);
  });

  it("keeps lists nested past the ninth level at the ninth", () => {
    expect(listLevel(12)).toBe(listLevel(8));
  });
});

describe("markers", () => {
  it("cycles bullets •, ◦, ▪ by depth", () => {
    expect([0, 1, 2, 3].map((depth) => listMarker("bullet", depth, 1))).toEqual(["•", "◦", "▪", "•"]);
  });

  it("numbers 1. / a. / i. by depth", () => {
    expect([0, 1, 2, 3].map((depth) => listMarker("ordered", depth, 4))).toEqual(["4.", "d.", "iv.", "4."]);
  });

  it("goes past z and into larger numerals as Word does", () => {
    expect(listMarker("ordered", 1, 27)).toBe("aa.");
    expect(listMarker("ordered", 1, 53)).toBe("aaa.");
    expect(listMarker("ordered", 2, 1999)).toBe("mcmxcix.");
  });

  it("draws each bullet as a shape, and numbers as text", () => {
    expect(["•", "◦", "▪", "1."].map(bulletShape)).toEqual(["disc", "circle", "square", null]);
  });
});
