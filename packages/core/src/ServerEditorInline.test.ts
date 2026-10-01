/**
 * An inline atom has to be able to size itself headlessly.
 *
 * Layout reaches a strategy through a registry the caller supplies, so a
 * headless caller needs one to pass.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "./ServerEditor";
import { StarterKit } from "./extensions/StarterKit";
import { Extension } from "./extensions/Extension";
// Through the barrel, because a consumer implementing a strategy has to be
// able to name the type.
import type { IBaseEditor, InlineStrategy } from "./index";

/**
 * An atom that sizes itself from the font it will be drawn in, the way a
 * page-number token does — the case that cannot work without a registry.
 */
const SIZED_ATOM: InlineStrategy = {
  measure: (_node, font) => ({ width: font.includes("24px") ? 84 : 42, height: 12 }),
  render: () => {},
};

const Sized = Extension.create({
  name: "sizedAtom",
  addNodes() {
    return {
      sizedAtom: {
        group: "inline",
        inline: true,
        atom: true,
        selectable: false,
        attrs: { dataTracked: { default: [] } },
        parseDOM: [{ tag: "span.sized" }],
        toDOM: () => ["span", { class: "sized" }],
      },
    };
  },
  addInlineHandlers() {
    return { sizedAtom: SIZED_ATOM };
  },
});

const doc = { type: "doc", content: [{ type: "paragraph" }] };

describe("ServerEditor", () => {
  it("carries the registry layout needs to reach an inline strategy", () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Sized], content: doc });

    const strategy = editor.inlineRegistry.get("sizedAtom");
    expect(strategy).toBeDefined();
    // It answers from the font, which is the whole reason it must be reachable.
    const measurer = { measureText: () => ({ width: 0 }) } as never;
    expect(strategy?.measure?.({} as never, "14px Georgia", measurer)).toEqual({ width: 42, height: 12 });
    expect(strategy?.measure?.({} as never, "24px Georgia", measurer)).toEqual({ width: 84, height: 12 });
  });

  it("offers the registry on the base contract, which is what a headless caller holds", () => {
    const editor: IBaseEditor = new ServerEditor({ extensions: [StarterKit, Sized], content: doc });
    expect(editor.inlineRegistry.get("sizedAtom")).toBeDefined();
  });

  it("has an empty registry rather than none when no extension declares one", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: doc });

    expect(editor.inlineRegistry).toBeDefined();
    expect(editor.inlineRegistry.get("sizedAtom")).toBeUndefined();
  });
});
