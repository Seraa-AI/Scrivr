import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createTestEditor } from "../../test-utils";

function threeParagraphs() {
  const editor = createTestEditor({
    content: { type: "doc", content: ["alpha", "beta", "gamma"].map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) },
  });
  const { tr, doc } = editor.getState();
  editor.applyTransaction(tr.setSelection(TextSelection.create(doc, 1, 6)));
  return editor;
}

const selected = (editor: ReturnType<typeof createTestEditor>) => {
  const { from, to } = editor.getState().selection;
  return [from, to];
};

describe("History", () => {
  it.each([
    ["an alignment", (editor: ReturnType<typeof createTestEditor>) => editor.commands.setAlignCenter()],
    ["a heading", (editor: ReturnType<typeof createTestEditor>) => editor.commands.setHeading({ level: 2 })],
    ["bold", (editor: ReturnType<typeof createTestEditor>) => editor.commands.toggleBold()],
  ])("keeps the selection through undo and redo of %s", (_name, change) => {
    const editor = threeParagraphs();
    expect(change(editor)).toBe(true);
    editor.commands.undo();
    expect(selected(editor)).toEqual([1, 6]);
    editor.commands.redo();
    expect(selected(editor)).toEqual([1, 6]);
  });
});
