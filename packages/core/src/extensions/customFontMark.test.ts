/**
 * A mark that changes the font belongs to its extension. These are written
 * only against `@scrivr/core`'s public surface: a heavier weight, a larger
 * size and a typewriter family, each declared through `addFontModifiers`, and
 * honoured wherever the editor asks what font a run is drawn in.
 */
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import {
  Extension,
  ExtensionManager,
  StarterKit,
  collectFontRequests,
  defaultPageConfig,
  runPipeline,
  type FontModifier,
} from "../index";
import { createMeasurer, createTestEditor } from "../test-utils";

const Typeset = Extension.create({
  name: "typeset",
  addMarks() {
    return {
      heavy: { toDOM: () => ["b", 0] },
      huge: { toDOM: () => ["big", 0] },
      typewriter: { toDOM: () => ["tt", 0] },
    };
  },
  addFontModifiers() {
    return new Map<string, FontModifier>([
      ["heavy", (parsed) => { parsed.weight = "900"; }],
      ["huge", (parsed) => { parsed.size = "40px"; }],
      ["typewriter", (parsed) => { parsed.family = "Courier New"; }],
    ]);
  },
});

const extensions = [StarterKit, Typeset];
const manager = new ExtensionManager(extensions);

const docWith = (mark: string) => manager.schema.nodeFromJSON({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "plain " }, { type: "text", text: "marked", marks: [{ type: mark }] }] },
] });

/** An editor with the selection inside the marked run. */
function editorIn(mark: string) {
  const editor = createTestEditor({ extensions, content: docWith(mark).toJSON() });
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 9, 11)));
  return editor;
}

describe("a font-changing mark from outside core", () => {
  it("is measured in the font it declares", () => {
    const layout = runPipeline(docWith("heavy"), {
      pageConfig: defaultPageConfig, measurer: createMeasurer(),
      fontConfig: manager.buildBlockStyles(), fontModifiers: manager.buildFontModifiers(),
    });
    const span = layout.pages[0]?.blocks[0]?.lines[0]?.spans.find((s) => s.kind === "text" && s.text === "marked");
    expect(span?.kind === "text" ? span.font : "").toMatch(/^900 /);
  });

  it("asks for the face it declares before layout", () => {
    const requests = collectFontRequests(docWith("heavy"), { family: "Arial", weight: 400, style: "normal", size: 14 }, {
      fontModifiers: manager.buildFontModifiers(),
    });
    expect(requests.map((r) => r.weight).sort()).toEqual([400, 900]);
  });

  it("is the size the editor reports at the selection", () => {
    expect(editorIn("huge").getActiveFontSize()).toBe(40);
  });

  it("is the family the editor reports at the selection", () => {
    expect(editorIn("typewriter").getActiveFontFamily().requested).toBe("Courier New");
  });
});
