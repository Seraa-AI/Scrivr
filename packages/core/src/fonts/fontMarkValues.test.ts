/**
 * What a font mark or a block's level can hold that does not name a font. A
 * stored value comes from JSON, collaboration or a command with no guard, so
 * layout and the editor's font readouts both read it with one rule: a value
 * that names nothing leaves the font as its block draws it.
 */
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { layoutBlock } from "../layout/BlockLayout";
import { buildStarterKitContext, createMeasurer, createTestEditor } from "../test-utils";

const { schema, fontConfig, fontModifiers } = buildStarterKitContext();

type Json = { type: string; attrs?: Record<string, unknown>; marks?: Json[]; content?: Json[]; text?: string };

/** An editor whose selection covers the one marked run in a level-1 heading. */
function editorOver(mark: Json) {
  const editor = createTestEditor({ content: { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title", marks: [mark] }] },
  ] } });
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
  return editor;
}

describe("a font size that names no size", () => {
  it.each([-5, 1e-7, Number.NaN])("leaves the block's size in place (%s)", (size) => {
    const editor = editorOver({ type: "fontSize", attrs: { size } });
    expect(editor.getActiveFontSize()).toBe(28);
    expect(editor.getActiveFontFamily().requested).toBe("Arial");
  });
});

describe("a font family that names no family", () => {
  it("leaves the block's family in place", () => {
    const editor = editorOver({ type: "fontFamily", attrs: { family: "" } });
    expect(editor.getActiveFontFamily().requested).toBe("Arial");
  });
});

describe("a heading level stored as text", () => {
  it("is drawn in its level's font, as it is spaced by its level's style", () => {
    const heading = schema.nodeFromJSON({ type: "heading", attrs: { level: "2" }, content: [{ type: "text", text: "Title" }] });
    const block = layoutBlock(heading, {
      nodePos: 0, x: 0, y: 0, availableWidth: 400, page: 1, measurer: createMeasurer(), fontConfig, fontModifiers,
    });
    const span = block.lines[0]?.spans[0];
    expect(span?.kind === "text" ? span.font : "").toMatch(/^bold 22px /);
    expect(block.spaceBefore).toBe(fontConfig["heading_2"]?.spaceBefore);
  });
});
