import { describe, expect, it } from "vitest";
import { buildStarterKitContext } from "../test-utils";
import { Extension } from "../extensions/Extension";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
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

describe("what @scrivr/core exports about lists", () => {
  it("exports what other packages ask, and keeps how a list looks inside List", () => {
    expect(typeof Reflect.get(core, "isListType")).toBe("function");
    const internal = [
      "LIST_LEVELS", "LIST_MARKER_HANGING", "listKind", "listLevel", "listMarker", "listStart",
      "bulletShape", "bulletBox", "listMarkerOf",
    ];
    expect(internal.filter((name) => Reflect.has(core, name))).toEqual([]);
  });
});
