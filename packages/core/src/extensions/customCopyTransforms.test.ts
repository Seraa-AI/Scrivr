/**
 * What copied markup says about a node belongs to the extension that owns it.
 * This one is written only against `@scrivr/core`'s public surface: a
 * redaction mark whose reviewer note stays in the editor and never reaches the
 * clipboard, with no engine change.
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { Extension, ExtensionManager, StarterKit, serializeSelectionToHtml } from "../index";
import { createTestEditor } from "../test-utils";

const Redactions = Extension.create({
  name: "redactions",
  addMarks() {
    return {
      redaction: {
        attrs: { note: { default: "" } },
        toDOM: (mark) => ["span", { "data-redaction": "", "data-note": String(mark.attrs["note"]) }, 0],
      },
    };
  },
  addCopyHtmlTransforms() {
    return [
      (root) => {
        for (const span of Array.from(root.querySelectorAll("[data-redaction]"))) span.removeAttribute("data-note");
      },
    ];
  },
});

const manager = new ExtensionManager([StarterKit, Redactions]);
const { schema } = manager;

const redactedDoc = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [
      { type: "text", text: "The " },
      { type: "text", text: "secret", marks: [{ type: "redaction", attrs: { note: "client name" } }] },
    ],
  }],
};

function copiedHtml(): string {
  const doc = schema.nodeFromJSON(redactedDoc);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
  return serializeSelectionToHtml(state, schema, manager.buildCopyHtmlTransforms()) ?? "";
}

describe("a copy transform from outside core", () => {
  it("rewrites the copied markup as its extension declares", () => {
    const html = copiedHtml();
    expect(html).toContain("data-redaction");
    expect(html).not.toContain("client name");
  });

  it("runs when the editor copies", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({ extensions: [StarterKit, Redactions], content: redactedDoc });
    editor.mount(container);
    editor.selection.setSelection(1, editor.getState().doc.content.size - 1);
    const clipboardData = new DataTransfer();
    container.querySelector("textarea")?.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData }));
    const html = clipboardData.getData("text/html");
    editor.destroy();
    container.remove();

    expect(html).toContain("data-redaction");
    expect(html).not.toContain("client name");
  });
});
