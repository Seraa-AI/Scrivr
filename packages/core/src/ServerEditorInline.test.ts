/**
 * An inline atom has to be able to size itself headlessly.
 *
 * Layout reaches an inline node's strategy through a registry the caller
 * supplies. The registry lived on `Editor` only, so a `ServerEditor` had nothing
 * to pass: `measure()` never ran, the span carried no resolved face, and a PDF
 * node handler that draws its own text was handed no font to draw it in — the
 * correct response to which is to refuse. A headless render and a browser render
 * of the same document disagreed, and the atoms that size themselves from a
 * font were exactly the ones that could not work.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "./ServerEditor";
import { StarterKit } from "./extensions/StarterKit";
import { Extension } from "./extensions/Extension";
import type { InlineStrategy } from "./layout/BlockRegistry";

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
    // The same strategy the browser would measure with, not a stand-in — and it
    // answers from the font, which is the whole reason it must be reachable.
    const measurer = { measureText: () => ({ width: 0 }) } as never;
    expect(strategy?.measure?.({} as never, "14px Georgia", measurer)).toEqual({ width: 42, height: 12 });
    expect(strategy?.measure?.({} as never, "24px Georgia", measurer)).toEqual({ width: 84, height: 12 });
  });

  it("has an empty registry rather than none when no extension declares one", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: doc });

    expect(editor.inlineRegistry).toBeDefined();
    expect(editor.inlineRegistry.get("sizedAtom")).toBeUndefined();
  });
});
