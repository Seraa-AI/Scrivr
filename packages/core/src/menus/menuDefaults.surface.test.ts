import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: the point of this change is
// that a consumer can reach these, and `tsc` fails here the moment one stops
// being exported.
import {
  defaultBubbleMenuShouldShow,
  defaultFloatingMenuShouldShow,
  ServerEditor,
  StarterKit,
} from "../index";
import type { BubbleMenuOptions } from "../index";
import { TextSelection } from "prosemirror-state";

function editorWith(text: string) {
  const editor = new ServerEditor({ extensions: [StarterKit] });
  editor.setContent({
    type: "doc",
    content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }],
  });
  return editor;
}

function selectAll(editor: ReturnType<typeof editorWith>) {
  const state = editor.getState();
  const tr = state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1));
  editor.applyTransaction(tr);
  return editor.getState();
}

describe("the menu defaults a consumer composes with", () => {
  it("are reachable from the package", () => {
    expect(typeof defaultBubbleMenuShouldShow).toBe("function");
    expect(typeof defaultFloatingMenuShouldShow).toBe("function");
  });

  it("compose into a widened rule, which is what they exist for", () => {
    const editor = editorWith("selected text");
    const collapsed = editor.getState();

    let capturing = false;
    const shouldShow: NonNullable<BubbleMenuOptions["shouldShow"]> = (state) =>
      capturing || defaultBubbleMenuShouldShow(state);

    // The default says no on a collapsed selection; the consumer's extra case
    // says yes, without re-implementing "not empty, not a cell, has text".
    expect(defaultBubbleMenuShouldShow(collapsed)).toBe(false);
    expect(shouldShow(collapsed)).toBe(false);
    capturing = true;
    expect(shouldShow(collapsed)).toBe(true);
  });

  it("still answers the case it was written for", () => {
    const editor = editorWith("selected text");
    expect(defaultBubbleMenuShouldShow(selectAll(editor))).toBe(true);
  });

  it("the floating default answers an empty root block", () => {
    expect(defaultFloatingMenuShouldShow(editorWith("").getState())).toBe(true);
    expect(defaultFloatingMenuShouldShow(editorWith("has text").getState())).toBe(false);
  });
});
