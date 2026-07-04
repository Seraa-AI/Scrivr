import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { CellSelection } from "../table/cellSelection";
import { defaultBubbleMenuShouldShow } from "./createBubbleMenu";

/**
 * The bubble menu is the text-formatting toolbar. A table cell range shows a
 * table toolbar instead (Google-Docs style), so it must not trigger the bubble
 * even though its head cell holds text.
 */

function tableEditor() {
  return new ServerEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100, 100] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
              ],
            },
          ],
        },
      ],
    },
  });
}

function cellNodePos(editor: ServerEditor, index: number): number {
  let pos = -1;
  let seen = 0;
  editor.getState().doc.descendants((n, p) => {
    if (n.type.name === "tableCell") {
      if (seen === index) pos = p;
      seen++;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no cell ${index}`);
  return pos;
}

describe("defaultBubbleMenuShouldShow", () => {
  it("shows for a non-empty text selection", () => {
    const editor = tableEditor();
    const doc = editor.getState().doc;
    // Select within a single cell's text ("A").
    const start = cellNodePos(editor, 0) + 2;
    editor.applyTransaction(
      editor.getState().tr.setSelection(TextSelection.create(doc, start, start + 1)),
    );
    expect(defaultBubbleMenuShouldShow(editor.getState())).toBe(true);
  });

  it("does not show for a CellSelection", () => {
    const editor = tableEditor();
    const doc = editor.getState().doc;
    const sel = CellSelection.between(doc, cellNodePos(editor, 0), cellNodePos(editor, 1))!;
    editor.applyTransaction(editor.getState().tr.setSelection(sel));
    expect(defaultBubbleMenuShouldShow(editor.getState())).toBe(false);
  });
});
