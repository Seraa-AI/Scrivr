import { describe, expect, it } from "vitest";
import { buildStarterKitContext } from "../test-utils";
import type { LayoutLine } from "../layout/LineBreaker";
import * as lists from "./lists";
import * as core from "../index";

const { schema } = buildStarterKitContext();
const item = schema.nodes["listItem"]?.create(null, schema.node("paragraph"));
const orderedFrom = (order: unknown) => schema.node("orderedList", { order }, item);

describe("what is a list", () => {
  it("is a node whose items are list items", () => {
    const isList = (name: string) => {
      const type = schema.nodes[name];
      return type !== undefined && lists.isListType(type);
    };
    expect(["bulletList", "orderedList"].map(isList)).toEqual([true, true]);
    expect(["listItem", "paragraph", "doc"].map(isList)).toEqual([false, false, false]);
  });

  it("names its kind", () => {
    expect(lists.listKind(schema.node("bulletList", null, item))).toBe("bullet");
    expect(lists.listKind(orderedFrom(1))).toBe("ordered");
    expect(lists.listKind(schema.node("paragraph"))).toBeNull();
  });
});

describe("where an ordered list starts", () => {
  it("starts at its order", () => {
    expect(lists.listStart(orderedFrom(3))).toBe(3);
    expect(lists.listStart(schema.node("bulletList", null, item))).toBe(1);
  });

  it("keeps a start a paste or a peer sends within Word's range", () => {
    expect(lists.listStart(orderedFrom(2147483647))).toBe(32767);
    expect(lists.listStart(orderedFrom(-5))).toBe(0);
  });

  it("draws the largest start's marker at once, at every format", () => {
    const n = lists.listStart(orderedFrom(Number.MAX_SAFE_INTEGER));
    const markers = [0, 1, 2].map((depth) => lists.listMarker("ordered", depth, n));
    expect(Math.max(...markers.map((marker) => marker.length))).toBeLessThan(2000);
  });
});

describe("the level table", () => {
  it("indents each level the same step past the one above", () => {
    const indents = Array.from({ length: 9 }, (_, depth) => lists.listLevel(depth).textIndent);
    const steps = indents.slice(1).map((indent, i) => indent - (indents[i] ?? 0));
    expect(new Set(steps).size).toBe(1);
    expect(indents[0]).toBe(steps[0]);
  });

  it("keeps lists nested past the ninth level at the ninth", () => {
    expect(lists.listLevel(12)).toEqual(lists.listLevel(8));
  });

  it("hands each caller its own level, so nothing can change the table", () => {
    const level = lists.listLevel(0);
    Reflect.set(level.bullet, "glyph", "x");
    expect(lists.listMarker("bullet", 0, 1)).toBe("•");
  });
});

describe("markers", () => {
  it("cycles bullets •, ◦, ▪ by depth", () => {
    expect([0, 1, 2, 3].map((depth) => lists.listMarker("bullet", depth, 1))).toEqual(["•", "◦", "▪", "•"]);
  });

  it("numbers 1. / a. / i. by depth", () => {
    expect([0, 1, 2, 3].map((depth) => lists.listMarker("ordered", depth, 4))).toEqual(["4.", "d.", "iv.", "4."]);
  });

  it("goes past z and into larger numerals as Word does", () => {
    expect(lists.listMarker("ordered", 1, 27)).toBe("aa.");
    expect(lists.listMarker("ordered", 1, 53)).toBe("aaa.");
    expect(lists.listMarker("ordered", 2, 1999)).toBe("mcmxcix.");
  });

  it("draws each bullet as a shape, and numbers as text", () => {
    expect(["•", "◦", "▪", "1."].map(lists.bulletShape)).toEqual(["disc", "circle", "square", null]);
  });
});

describe("the marker's font", () => {
  const lineIn = (font: string): LayoutLine => ({
    spans: [{ kind: "text", text: "x", font, x: 0, width: 5, docPos: 1 }],
    width: 5, ascent: 10, descent: 3, lineHeight: 16, textAscent: 10, cursorHeight: 16, xHeight: 6,
  });

  it("is the font of the line's first run", () => {
    expect(lists.listMarkerFont(lineIn("bold 18px Georgia"))).toEqual({ font: "bold 18px Georgia", size: 18 });
  });

  it("never has size 0, with no line or a font that names no size", () => {
    expect(lists.listMarkerFont(undefined).size).toBeGreaterThan(0);
    expect(lists.listMarkerFont(lineIn("Georgia")).size).toBeGreaterThan(0);
    expect(lists.listMarkerFont(lineIn("0px Georgia")).size).toBeGreaterThan(0);
  });
});

describe("what @scrivr/core exports about lists", () => {
  it("exports what other packages use, and keeps the level table internal", () => {
    const listExports = ["isListType", "bulletShape", "bulletBox", "listMarkerFont"];
    expect(listExports.filter((name) => typeof Reflect.get(core, name) !== "function")).toEqual([]);
    const internal = ["LIST_LEVELS", "LIST_MARKER_HANGING", "listKind", "listLevel", "listMarker", "listStart"];
    expect(internal.filter((name) => Reflect.has(core, name))).toEqual([]);
  });
});
