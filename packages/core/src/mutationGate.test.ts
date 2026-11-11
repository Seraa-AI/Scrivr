/**
 * Whether a transaction may change the document.
 *
 * Two facts decide it. `readOnly` is about the viewer: they may not author, but
 * a collaborator's edits still reach them. `sealed` is about the document: it
 * no longer changes, from anyone. Both refuse out loud — a host learns an edit
 * was turned away instead of noticing the document did not change.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Plugin, TextSelection, type Transaction } from "prosemirror-state";
import { ServerEditor } from "./ServerEditor";
import { Extension } from "./extensions/Extension";
import { StarterKit } from "./extensions/StarterKit";
import { COLLAB_SYNC_META } from "./extensions/built-in/UniqueId";
import { EditorSurface } from "./surfaces/EditorSurface";
import { createTestEditor } from "./test-utils";
import type { Editor } from "./Editor";

const hello = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

const serverEditor = (extensions: Extension[] = []) =>
  new ServerEditor({ extensions: [StarterKit, ...extensions], content: hello });

const textOf = (editor: { getState(): { doc: { textContent: string } } }) =>
  editor.getState().doc.textContent;

const typed = (editor: ServerEditor, text: string): Transaction =>
  editor.getState().tr.insertText(text, 1);

const fromCollaborator = (tr: Transaction): Transaction => tr.setMeta(COLLAB_SYNC_META, true);

const caretAt = (editor: ServerEditor, pos: number): Transaction => {
  const state = editor.getState();
  return state.tr.setSelection(TextSelection.create(state.doc, pos));
};

describe("a read-only editor", () => {
  it("refuses an edit made on this client, and says why", () => {
    const editor = serverEditor();
    editor.setReadOnly(true);
    const denied = vi.fn();
    editor.on("mutationDenied", denied);

    expect(editor.applyTransaction(typed(editor, "X"))).toBe(false);

    expect(textOf(editor)).toBe("Hello");
    expect(denied).toHaveBeenCalledWith({ reason: "read-only", origin: "local" });
  });

  it("still receives a collaborator's edit", () => {
    const editor = serverEditor();
    editor.setReadOnly(true);

    expect(editor.applyTransaction(fromCollaborator(typed(editor, "X")))).toBe(true);

    expect(textOf(editor)).toBe("XHello");
  });

  it("still lets the viewer move the caret", () => {
    const editor = serverEditor();
    editor.setReadOnly(true);

    expect(editor.applyTransaction(caretAt(editor, 3))).toBe(true);

    expect(editor.getState().selection.head).toBe(3);
  });

  it("accepts edits again once it is writable", () => {
    const editor = serverEditor();
    editor.setReadOnly(true);
    editor.setReadOnly(false);

    expect(editor.applyTransaction(typed(editor, "X"))).toBe(true);
    expect(textOf(editor)).toBe("XHello");
  });
});

describe("a sealed editor", () => {
  it("refuses a collaborator's edit too", () => {
    const editor = serverEditor();
    editor.seal();
    const denied = vi.fn();
    editor.on("mutationDenied", denied);

    expect(editor.applyTransaction(fromCollaborator(typed(editor, "X")))).toBe(false);

    expect(textOf(editor)).toBe("Hello");
    expect(denied).toHaveBeenCalledWith({ reason: "sealed", origin: "remote" });
  });

  it("refuses commands", () => {
    const editor = serverEditor();
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
    editor.seal();

    expect(editor.commands.toggleBold()).toBe(false);
    expect(editor.getState().doc.rangeHasMark(1, 6, editor.schema.marks["bold"]!)).toBe(false);
  });

  it("still lets the reader select", () => {
    const editor = serverEditor();
    editor.seal();

    expect(editor.applyTransaction(caretAt(editor, 3))).toBe(true);
    expect(editor.getState().selection.head).toBe(3);
  });

  it("stays sealed when the host makes it writable", () => {
    const editor = serverEditor();
    editor.seal();
    editor.setReadOnly(false);

    expect(editor.sealed).toBe(true);
    expect(editor.readOnly).toBe(true);
    expect(editor.applyTransaction(typed(editor, "X"))).toBe(false);
  });

  it("abandons a deferred edit that finishes after the seal", async () => {
    const editor = serverEditor();
    const onAbandoned = vi.fn();
    let release!: () => void;
    editor.deferEdit({
      work: () => new Promise<void>((resolve) => (release = resolve)),
      edit: () => editor.applyTransaction(typed(editor, "X")),
      onAbandoned,
    });

    editor.seal();
    release();
    await new Promise((r) => setTimeout(r, 0));

    expect(onAbandoned).toHaveBeenCalledWith("sealed", undefined);
    expect(textOf(editor)).toBe("Hello");
  });
});

describe("an editor constructed sealed", () => {
  it("shows its content and refuses every change", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: hello, sealed: true });

    expect(textOf(editor)).toBe("Hello");
    expect(editor.sealed).toBe(true);
    expect(editor.applyTransaction(fromCollaborator(typed(editor, "X")))).toBe(false);
  });

  it("is sealed in the browser editor too, with input and caret off", () => {
    const editor = createTestEditor({ extensions: [StarterKit], content: hello, sealed: true });

    expect(editor.sealed).toBe(true);
    expect(editor.readOnly).toBe(true);
    expect(editor.applyTransaction(editor.getState().tr.insertText("X", 1))).toBe(false);
    editor.destroy();
  });
});

describe("what the gate judges", () => {
  // A plugin that answers any caret move by writing to the document — the
  // shape normalizers and id stampers have.
  const WritesOnCaretMove = Extension.create({
    name: "writesOnCaretMove",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction(transactions, _old, next) {
            const caretOnly = transactions.some((t) => t.selectionSet && !t.docChanged);
            return caretOnly ? next.tr.insertText("!", 1) : null;
          },
        }),
      ];
    },
  });

  it("refuses the whole result when an appended transaction changes the document", () => {
    const editor = serverEditor([WritesOnCaretMove]);
    editor.setReadOnly(true);

    expect(editor.applyTransaction(caretAt(editor, 3))).toBe(false);

    // Nothing partial lands: not the appended write, not the caret move.
    expect(textOf(editor)).toBe("Hello");
    expect(editor.getState().selection.head).not.toBe(3);
  });
});

describe("a header or footer surface", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  const registeredSurface = (): EditorSurface => {
    editor = createTestEditor({ extensions: [StarterKit] });
    const surface = new EditorSurface({
      id: "header:default",
      owner: "test",
      schema: editor.schema,
      initialDocJSON: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.surfaces.register(surface);
    return surface;
  };

  it("refuses an edit once the document is sealed", () => {
    const surface = registeredSurface();
    editor.seal();

    expect(surface.dispatch(surface.state.tr.insertText("X", 1))).toBe(false);

    expect(surface.state.doc.textContent).toBe("");
    expect(surface.isDirty).toBe(false);
  });

  it("refuses an edit made by a read-only viewer", () => {
    const surface = registeredSurface();
    editor.setReadOnly(true);

    expect(surface.dispatch(surface.state.tr.insertText("X", 1))).toBe(false);
    expect(surface.state.doc.textContent).toBe("");
  });

  it("takes edits while the document is writable", () => {
    const surface = registeredSurface();

    expect(surface.dispatch(surface.state.tr.insertText("X", 1))).toBe(true);
    expect(surface.state.doc.textContent).toBe("X");
  });
});
