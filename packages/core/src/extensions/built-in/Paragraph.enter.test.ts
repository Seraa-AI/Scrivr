import { describe, it, expect } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { splitBlockInheritAttrs } from "./Paragraph";

/**
 * Enter while an image is selected.
 *
 * An inline image sits in the sentence, so Enter replaces it with a break, the
 * same as selected text. An anchored one is out of the flow — its position is
 * an anchor, not a place in a sentence — so splitting there inserts a paragraph
 * the reader never asked for, somewhere they cannot see it. Repeat the keypress
 * and the empty paragraphs pile up while the visible text never changes.
 */

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function editorWithImage(wrapMode: string): ServerEditor {
  return new ServerEditor({
    extensions: [StarterKit],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            {
              type: "image",
              attrs: { src: PNG, width: 200, height: 100, wrapMode, xAlign: "left" },
            },
            { type: "text", text: " after" },
          ],
        },
      ],
    },
  });
}

function imagePos(editor: ServerEditor): number {
  let found: number | null = null;
  editor.getState().doc.descendants((node, pos) => {
    if (found === null && node.type.name === "image") found = pos;
    return found === null;
  });
  if (found === null) throw new Error("no image in the document");
  return found;
}

/** The command the Paragraph extension binds to Enter. */
function pressEnter(editor: ServerEditor): void {
  splitBlockInheritAttrs(editor.getState(), (tr) => editor.applyTransaction(tr));
}

function blockCount(editor: ServerEditor): number {
  return editor.getState().doc.childCount;
}

describe("Enter with an image selected", () => {
  it.each(["behind", "front", "square", "top-bottom"])(
    "%s: does nothing — no split at the anchor, no empty paragraph",
    (wrapMode) => {
      const editor = editorWithImage(wrapMode);
      const pos = imagePos(editor);
      editor.applyTransaction(
        editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, pos)),
      );

      const before = editor.getState().doc.toJSON();
      const blocksBefore = blockCount(editor);

      pressEnter(editor);
      pressEnter(editor);
      pressEnter(editor);

      expect(blockCount(editor)).toBe(blocksBefore);
      expect(editor.getState().doc.toJSON()).toEqual(before);
    },
  );

  it("inline: still splits, because an inline image is content in the sentence", () => {
    const editor = editorWithImage("inline");
    const pos = imagePos(editor);
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, pos)),
    );

    const blocksBefore = blockCount(editor);
    pressEnter(editor);

    expect(blockCount(editor)).toBe(blocksBefore + 1);
  });

  it("plain text: Enter still splits the paragraph", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "split me" }] }],
      },
    });
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 4)));

    const blocksBefore = blockCount(editor);
    pressEnter(editor);
    expect(blockCount(editor)).toBe(blocksBefore + 1);
  });
});
