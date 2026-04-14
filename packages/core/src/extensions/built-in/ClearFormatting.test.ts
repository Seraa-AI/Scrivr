import { describe, it, expect } from "vitest";
import { Editor } from "../../Editor";
import { StarterKit } from "../StarterKit";
import { TextSelection, AllSelection } from "prosemirror-state";

function makeEditor() {
  const editor = new Editor({ extensions: [StarterKit] });
  return editor;
}

/** Type text into editor */
function type(editor: Editor, text: string) {
  const state = editor.getState();
  const tr = state.tr.insertText(text);
  editor["_viewDispatch"](tr);
}

/** Select all content */
function selectAll(editor: Editor) {
  const state = editor.getState();
  editor["_viewDispatch"](state.tr.setSelection(new AllSelection(state.doc)));
}

/** Apply a command by name */
function run(editor: Editor, cmd: string, ...args: unknown[]) {
  const command = (editor.commands as Record<string, ((...a: unknown[]) => void) | undefined>)[cmd];
  command?.(...args);
}

describe("ClearFormatting", () => {
  it("removes bold mark from selection", () => {
    const editor = makeEditor();
    type(editor, "hello");
    selectAll(editor);
    run(editor, "toggleBold");
    expect(editor.getActiveMarks()).toContain("bold");

    run(editor, "clearFormatting");
    expect(editor.getActiveMarks()).not.toContain("bold");
  });

  it("removes multiple marks at once", () => {
    const editor = makeEditor();
    type(editor, "hello");
    selectAll(editor);
    run(editor, "toggleBold");
    run(editor, "toggleItalic");
    run(editor, "toggleUnderline");

    run(editor, "clearFormatting");
    const marks = editor.getActiveMarks();
    expect(marks).not.toContain("bold");
    expect(marks).not.toContain("italic");
    expect(marks).not.toContain("underline");
  });

  it("removes color mark", () => {
    const editor = makeEditor();
    type(editor, "hello");
    selectAll(editor);
    run(editor, "setColor", "#ff0000");
    expect(editor.getActiveMarks()).toContain("color");

    run(editor, "clearFormatting");
    expect(editor.getActiveMarks()).not.toContain("color");
  });

  it("removes font size mark", () => {
    const editor = makeEditor();
    type(editor, "hello");
    selectAll(editor);
    run(editor, "setFontSize", 24);
    expect(editor.getActiveMarks()).toContain("font_size");

    run(editor, "clearFormatting");
    expect(editor.getActiveMarks()).not.toContain("font_size");
  });

  it("converts heading to paragraph", () => {
    const editor = makeEditor();
    run(editor, "setHeading1");
    type(editor, "Title");
    // cursor is inside heading — no need for selectAll
    expect(editor.getBlockInfo().blockType).toBe("heading");

    selectAll(editor);
    run(editor, "clearFormatting");

    // Move cursor inside content to check block type
    editor.selection.moveCursorTo(1);
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
  });

  it("resets alignment to default", () => {
    const editor = makeEditor();
    type(editor, "hello");
    run(editor, "setAlignCenter");
    expect(editor.getBlockInfo().blockAttrs["align"]).toBe("center");

    selectAll(editor);
    run(editor, "clearFormatting");

    editor.selection.moveCursorTo(1);
    const align = editor.getBlockInfo().blockAttrs["align"];
    // "left" and undefined are both the default — neither should be "center"
    expect(align === undefined || align === "left").toBe(true);
  });

  it("converts bullet list to plain paragraph", () => {
    const editor = makeEditor();
    run(editor, "toggleBulletList");
    type(editor, "item");
    selectAll(editor);
    run(editor, "clearFormatting");

    editor.selection.moveCursorTo(1);
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
  });

  it("converts ordered list to plain paragraph", () => {
    const editor = makeEditor();
    run(editor, "toggleOrderedList");
    type(editor, "item");
    selectAll(editor);
    run(editor, "clearFormatting");

    editor.selection.moveCursorTo(1);
    expect(editor.getBlockInfo().blockType).toBe("paragraph");
  });

  it("no selection — clears marks on current word only", () => {
    const editor = makeEditor();
    type(editor, "hello");
    selectAll(editor);
    run(editor, "toggleBold");
    // Collapse cursor to middle of word
    const state = editor.getState();
    const mid = state.doc.resolve(3);
    editor["_viewDispatch"](state.tr.setSelection(TextSelection.create(state.doc, mid.pos)));

    run(editor, "clearFormatting");

    // Move to start and check — bold should be gone from the word
    editor.selection.moveCursorTo(1);
    expect(editor.getActiveMarks()).not.toContain("bold");
  });

  it("Mod-\\ shortcut is registered", () => {
    const editor = makeEditor();
    const keymap = editor["_manager"].buildKeymap();
    expect("Mod-\\" in keymap).toBe(true);
  });

  it("toolbar item is registered", () => {
    const editor = makeEditor();
    const item = editor.toolbarItems.find((i) => i.command === "clearFormatting");
    expect(item).toBeDefined();
    expect(item?.title).toMatch(/clear formatting/i);
  });
});
