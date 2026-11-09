import { describe, expect, it } from "vitest";
import { buildStarterKitContext, createMeasurer } from "../test-utils";
import { Extension } from "../extensions/Extension";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import * as lists from "./lists";
import * as core from "../index";
import type { BulletBox, BulletShape, ListMarker, ListMarkerFont } from "../index";

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

  it("holds only list items: a node that mixes them with paragraphs is not a list", () => {
    const Mixed = Extension.create({
      name: "mixedList",
      addNodes() {
        return {
          mixedList: { group: "block", content: "(listItem | paragraph)+", toDOM: () => ["ul", 0] },
          itemList: { group: "block", content: "listItem+", toDOM: () => ["ul", 0] },
        };
      },
    });
    const custom = new ExtensionManager([StarterKit, Mixed]).schema;
    const isList = (name: string) => {
      const type = custom.nodes[name];
      return type !== undefined && lists.isListType(type);
    };
    expect([isList("mixedList"), isList("itemList")]).toEqual([false, true]);
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

  it("keeps a start a paste or a peer sends within MIN_START–MAX_START", () => {
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

  it("cannot be changed through a level it hands out", () => {
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

describe("what @scrivr/core exports about lists", () => {
  it("exports what other packages use, and keeps the level table internal", () => {
    const listExports = ["isListType", "bulletShape", "bulletBox", "listMarkerOf"];
    expect(listExports.filter((name) => typeof Reflect.get(core, name) !== "function")).toEqual([]);
    const internal = ["LIST_LEVELS", "LIST_MARKER_HANGING", "listKind", "listLevel", "listMarker", "listStart"];
    expect(internal.filter((name) => Reflect.has(core, name))).toEqual([]);
  });

  it("exports the types those functions take and return", () => {
    const shape = "disc" satisfies BulletShape;
    const box = core.bulletBox(10) satisfies BulletBox;
    const face: ListMarkerFont = { font: "14px Arial", size: 14 };
    const marker = core.listMarkerOf({ ...core.layoutBlock(buildStarterKitContext().schema.node("paragraph"), {
      nodePos: 0, x: 0, y: 0, availableWidth: 100, page: 1, measurer: createMeasurer(),
    }), listMarker: "1.", listMarkerX: 0, listMarkerFace: face }) satisfies ListMarker | null;
    expect([core.bulletShape("•"), box.size, marker?.size]).toEqual([shape, 3, 14]);
  });
});
