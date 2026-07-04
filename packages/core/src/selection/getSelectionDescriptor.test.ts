import { describe, it, expect, afterEach } from "vitest";
import { AllSelection } from "prosemirror-state";
import { createTestEditor } from "../test-utils";
import type { Editor } from "../Editor";

/**
 * editor.getSelectionDescriptor() is the capability-carrying, kind-tagged view
 * of the active selection that UI reads instead of `instanceof`-ing the PM
 * selection.
 */
function editorWithImage(readOnly = false): Editor {
  return createTestEditor({
    readOnly,
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
        { type: "paragraph", content: [{ type: "image", attrs: { src: "x.png" } }] },
      ],
    },
  });
}

describe("getSelectionDescriptor", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("describes a text range: kind text, formattable, copyable", () => {
    editor = editorWithImage();
    editor.selection.setSelection(1, 6);
    const d = editor.getSelectionDescriptor();
    expect(d.kind).toBe("text");
    expect(d.empty).toBe(false);
    expect(d.capabilities.formatText).toBe(true);
    expect(d.capabilities.copy).toBe(true);
    expect(d.capabilities.resize).toBe(false);
    expect(d.surfaceId).toBe("body");
  });

  it("describes a collapsed caret as empty and not copyable", () => {
    editor = editorWithImage();
    editor.selection.moveCursorTo(3);
    const d = editor.getSelectionDescriptor();
    expect(d.kind).toBe("text");
    expect(d.empty).toBe(true);
    expect(d.capabilities.copy).toBe(false);
  });

  it("describes a selected image: kind image (extension-owned), resizable", () => {
    editor = editorWithImage();
    const doc = editor.getState().doc;
    let imgPos = -1;
    doc.descendants((n, pos) => {
      if (n.type.name === "image") imgPos = pos;
    });
    editor.selectNode(imgPos);
    const d = editor.getSelectionDescriptor();
    // The Image extension registers its own behavior, so it wins over the
    // generic node fallback.
    expect(d.kind).toBe("image");
    expect(d.capabilities.resize).toBe(true);
    expect(d.capabilities.drag).toBe(true);
    expect(d.capabilities.formatText).toBe(false);
  });

  it("describes a select-all as kind all", () => {
    editor = editorWithImage();
    const s = editor.getState();
    editor.applyTransaction(s.tr.setSelection(new AllSelection(s.doc)));
    const d = editor.getSelectionDescriptor();
    expect(d.kind).toBe("all");
    expect(d.capabilities.copy).toBe(true);
  });

  it("keeps copy available but suppresses mutations in read-only mode", () => {
    editor = editorWithImage(true);
    editor.selection.setSelection(1, 6);
    const text = editor.getSelectionDescriptor();
    expect(text.capabilities).toMatchObject({
      copy: true,
      cut: false,
      delete: false,
      formatText: false,
    });

    const doc = editor.getState().doc;
    let imgPos = -1;
    doc.descendants((n, pos) => {
      if (n.type.name === "image") imgPos = pos;
    });
    editor.selectNode(imgPos);
    const image = editor.getSelectionDescriptor();
    expect(image.capabilities).toMatchObject({
      copy: true,
      cut: false,
      delete: false,
      drag: false,
      resize: false,
    });
  });
});
