/**
 * Fields. The inline field is a box: one a signer completes, which the
 * document never holds a value for, or an author's checkbox, whose state is
 * content like any other.
 */
import { describe, expect, it } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { DOMParser, DOMSerializer, type Node as PmNode } from "prosemirror-model";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { Field, listSignerFields } from "./Field";
import { createTestEditor } from "../../test-utils";
import { DefaultFontProvider } from "../../fonts/DefaultFontProvider";

const terms = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Signed: " }] }],
};

const drafter = () => {
  const editor = new ServerEditor({ extensions: [StarterKit, Field], content: terms });
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 9)));
  return editor;
};

const fields = (editor: ServerEditor) => {
  const found: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
  editor.getState().doc.descendants((node, pos) => {
    if (node.type.name === "field") found.push({ pos, attrs: node.attrs });
  });
  return found;
};

describe("a signer field", () => {
  it("is listed by role for the host to assign, with an id of its own", () => {
    const editor = drafter();

    expect(
      editor.commands.insertField({ kind: "signature", fill: "signer", role: "client", required: true }),
    ).toBe(true);

    expect(listSignerFields(editor.getState().doc)).toEqual([{ id: expect.any(String), role: "client", kind: "signature", required: true, options: [] }]);
  });

  it("is listed with a dropdown's choices, which a host needs to ask for one", () => {
    const editor = drafter();

    editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client", options: [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }] });

    expect(listSignerFields(editor.getState().doc)).toEqual([
      { id: expect.any(String), role: "client", kind: "dropdown", required: false, options: [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }] },
    ]);
  });

  it("cannot be inserted without a role, since nobody could be asked to complete it", () => {
    const editor = drafter();

    expect(editor.commands.insertField({ kind: "signature", fill: "signer" })).toBe(false);
    expect(fields(editor)).toEqual([]);
  });

  it("holds no value — a signer's checkbox cannot be checked in the document", () => {
    const editor = drafter();
    editor.commands.insertField({ kind: "checkbox", fill: "signer", role: "client" });
    const [box] = fields(editor);
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, box!.pos)),
    );

    expect(editor.commands.toggleFieldChecked()).toBe(false);
    expect(fields(editor)[0]!.attrs["checked"]).toBe(false);
  });

  it("gets a fresh id when copied, so one signature never fills two boxes", () => {
    const editor = drafter();
    editor.commands.insertField({ kind: "signature", fill: "signer", role: "client" });
    const [original] = fields(editor);
    const state = editor.getState();
    const copy = state.doc.slice(original!.pos, original!.pos + 1);

    editor.applyTransaction(state.tr.replace(state.doc.content.size - 1, state.doc.content.size - 1, copy));

    const ids = listSignerFields(editor.getState().doc).map((f) => f.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(original!.attrs["nodeId"]);
  });
});

describe("an author's checkbox", () => {
  it("toggles, and is not a field for anyone to sign", () => {
    const editor = drafter();
    editor.commands.insertField({ kind: "checkbox", fill: "author" });
    const [box] = fields(editor);
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, box!.pos)),
    );

    expect(editor.commands.toggleFieldChecked()).toBe(true);

    expect(fields(editor)[0]!.attrs["checked"]).toBe(true);
    expect(listSignerFields(editor.getState().doc)).toEqual([]);
  });

  it("only exists as a checkbox — an author fills text as text", () => {
    const editor = drafter();

    expect(editor.commands.insertField({ kind: "signature", fill: "author" })).toBe(false);
  });
});

describe("an author's text field", () => {
  const ranges = (editor: ServerEditor) => {
    const found: Array<{ text: string; id: unknown; placeholder: unknown }> = [];
    editor.getState().doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === "fieldRange");
      if (!node.isText || !mark) return true;
      const last = found.at(-1);
      if (last && last.id === mark.attrs["nodeId"]) last.text += node.text;
      else found.push({ text: node.text ?? "", id: mark.attrs["nodeId"], placeholder: mark.attrs["placeholder"] });
      return true;
    });
    return found;
  };
  const caret = (editor: ServerEditor, pos: number) => {
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };
  const select = (editor: ServerEditor, from: number, to: number) => {
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  };
  const type = (editor: ServerEditor, text: string) => {
    editor.applyTransaction(editor.getState().tr.insertText(text));
  };
  // "Signed: " is 8 characters; the field starts at 9.
  const withPlaceholder = () => {
    const editor = drafter();
    editor.commands.insertFieldRange({ kind: "text", prompt: "Client name" });
    return editor;
  };

  it("starts as Word's placeholder: the prompt, marked as one", () => {
    const editor = withPlaceholder();

    expect(ranges(editor)).toEqual([{ text: "Client name", id: expect.any(String), placeholder: true }]);
    expect(listSignerFields(editor.getState().doc)).toEqual([]);
  });

  it("selects the whole placeholder when the caret lands inside it", () => {
    const editor = withPlaceholder();
    caret(editor, 12);

    const { from, to } = editor.getState().selection;
    expect([from, to]).toEqual([9, 20]);
  });

  it("is filled by typing over the placeholder, keeping its id", () => {
    const editor = withPlaceholder();
    const [placeholder] = ranges(editor);
    caret(editor, 12);

    type(editor, "Acme Ltd");

    expect(ranges(editor)).toEqual([{ text: "Acme Ltd", id: placeholder!.id, placeholder: false }]);
  });

  it("wraps selected text as an already-filled field", () => {
    const editor = drafter();
    type(editor, "Acme Ltd");
    select(editor, 9, 17);

    editor.commands.insertFieldRange({ kind: "text", prompt: "Client name" });

    expect(ranges(editor)).toEqual([{ text: "Acme Ltd", id: expect.any(String), placeholder: false }]);
  });

  it("keeps text typed at its end, as Word does with the caret inside a control", () => {
    const editor = drafter();
    type(editor, "Acme");
    select(editor, 9, 13);
    editor.commands.insertFieldRange({ kind: "text", prompt: "Client name" });
    caret(editor, 13);

    type(editor, " Ltd");

    expect(ranges(editor).map((r) => r.text)).toEqual(["Acme Ltd"]);
  });

  it("lets the author step out at its end, so what follows is plain text", () => {
    const editor = drafter();
    type(editor, "Acme");
    select(editor, 9, 13);
    editor.commands.insertFieldRange({ kind: "text", prompt: "Client name" });
    caret(editor, 13);

    expect(editor.commands.exitFieldRange()).toBe(true);
    type(editor, ", signed");

    expect(ranges(editor).map((r) => r.text)).toEqual(["Acme"]);
    expect(editor.getState().doc.textContent).toBe("Signed: Acme, signed");
  });

  it("brings the placeholder back when its text is deleted", () => {
    const editor = withPlaceholder();
    const [placeholder] = ranges(editor);
    caret(editor, 12);
    type(editor, "Acme");
    select(editor, 9, 13);

    editor.applyTransaction(editor.getState().tr.deleteSelection());

    expect(ranges(editor)).toEqual([{ text: "Client name", id: placeholder!.id, placeholder: true }]);
  });

  it("goes away when deleted together with the text around it", () => {
    const editor = withPlaceholder();
    select(editor, 5, 20);

    editor.applyTransaction(editor.getState().tr.deleteSelection());

    expect(ranges(editor)).toEqual([]);
  });

  it("gets a fresh id when copied", () => {
    const editor = withPlaceholder();
    const [original] = ranges(editor);
    const state = editor.getState();
    const copy = state.doc.slice(9, 20);

    editor.applyTransaction(state.tr.replace(1, 1, copy));

    const ids = ranges(editor).map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(original!.id);
  });
});

describe("a block field", () => {
  const twoClauses = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Clause one" }] },
      { type: "paragraph", content: [{ type: "text", text: "Clause two" }] },
    ],
  };
  const blocks = (doc: PmNode) => {
    const out: Array<{ type: string; children: number; id: unknown }> = [];
    doc.content.forEach((n) => out.push({ type: n.type.name, children: n.childCount, id: n.attrs["nodeId"] }));
    return out;
  };

  it("wraps the selected paragraphs, with an id of its own", () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Field], content: twoClauses });
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 2, 15)));

    expect(editor.commands.insertFieldBlock({ kind: "text", prompt: "Special terms" })).toBe(true);

    expect(blocks(editor.getState().doc)[0]).toEqual({ type: "fieldBlock", children: 2, id: expect.any(String) });
    expect(editor.getState().doc.textContent).toBe("Clause oneClause two");
  });

  it("can be taken away again, leaving its paragraphs", () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Field], content: twoClauses });
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 2, 15)));
    editor.commands.insertFieldBlock({ kind: "text", prompt: "Special terms" });

    expect(editor.commands.unwrapFieldBlock()).toBe(true);

    expect(blocks(editor.getState().doc).some((b) => b.type === "fieldBlock")).toBe(false);
    expect(editor.getState().doc.textContent).toBe("Clause oneClause two");
  });

  it("lays its paragraphs out in the page's flow, with no box of its own", () => {
    const plain = createTestEditor({ extensions: [StarterKit, Field], content: twoClauses });
    const wrapped = createTestEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "fieldBlock", attrs: { kind: "text" }, content: twoClauses.content }] },
    });

    const ys = (editor: typeof plain) => editor.layout.pages[0]!.blocks.map((b) => [b.node.type.name, b.y]);
    expect(ys(wrapped)).toEqual(ys(plain));
    plain.destroy();
    wrapped.destroy();
  });
});

describe("fields as Markdown", () => {
  it("writes a field as its caption, a text field as its text, and a block field as its paragraphs", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Client: " },
              { type: "text", text: "Acme", marks: [{ type: "fieldRange", attrs: { nodeId: "r1", prompt: "Name" } }] },
              { type: "text", text: " " },
              { type: "field", attrs: { kind: "signature", fill: "signer", role: "client" } },
            ],
          },
          { type: "fieldBlock", content: [{ type: "paragraph", content: [{ type: "text", text: "Net 30." }] }] },
        ],
      },
    });

    expect(editor.getMarkdown()).toBe("Client: Acme [Signature · client]\n\nNet 30.");
  });
});

describe("kinds of field", () => {
  const editorWith = (field = Field) => {
    const editor = new ServerEditor({ extensions: [StarterKit, field], content: terms });
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 9)));
    return editor;
  };
  const only = (editor: ServerEditor) => fields(editor)[0]!.attrs;

  it("include the common signing details, each labelled", () => {
    const editor = editorWith();
    for (const kind of ["name", "email", "title", "company", "number"]) {
      expect(editor.commands.insertField({ kind, fill: "signer", role: "client" })).toBe(true);
    }

    expect(editor.getMarkdown()).toBe(
      "Signed: [Name · client][Email · client][Title · client][Company · client][Number · client]",
    );
  });

  it("include a dropdown, which needs the choices it offers", () => {
    const editor = editorWith();

    expect(editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client" })).toBe(false);
    expect(
      editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client", options: [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }] }),
    ).toBe(true);
    expect(only(editor)["options"]).toEqual([{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }]);
  });

  it("keep a dropdown's choices when copied as HTML and pasted back", () => {
    const editor = editorWith();
    const options = [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }];
    editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client", options });
    const { doc, schema } = editor.getState();

    const html = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    const pasted = DOMParser.fromSchema(schema).parse(html);

    let back: unknown = null;
    pasted.descendants((node) => {
      if (node.type.name === "field") back = node.attrs["options"];
    });
    expect(back).toEqual(options);
  });

  it("refuse a dropdown whose choices share an id, since a value could not say which was chosen", () => {
    const editor = editorWith();
    const options = [{ id: "net", label: "Net 30" }, { id: "net", label: "Net 60" }];

    expect(editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client", options })).toBe(false);
  });

  it("can be added by the host, with its own label and size", () => {
    const editor = editorWith(
      Field.configure({ kinds: { stamp: { label: "Company stamp", size: { width: 120, height: 120 } } } }),
    );

    expect(editor.commands.insertField({ kind: "stamp", fill: "signer", role: "client" })).toBe(true);

    expect([only(editor)["width"], only(editor)["height"]]).toEqual([120, 120]);
    expect(editor.getMarkdown()).toBe("Signed: [Company stamp · client]");
    expect(listSignerFields(editor.getState().doc)[0]!.kind).toBe("stamp");
  });

  it("must be registered to be inserted", () => {
    expect(editorWith().commands.insertField({ kind: "stamp", fill: "signer", role: "client" })).toBe(false);
  });

  it("behave as the control they declare — a host's agreement box is a checkbox", () => {
    const editor = editorWith(
      Field.configure({ kinds: { agree: { label: "I agree", size: { width: 16, height: 16 }, control: "checkbox" } } }),
    );
    editor.commands.insertField({ kind: "agree", fill: "author" });
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, fields(editor)[0]!.pos)),
    );

    expect(editor.commands.toggleFieldChecked()).toBe(true);
    expect(only(editor)["checked"]).toBe(true);
  });
});

describe("a field's box on the page", () => {
  it("keeps its fixed size, set in the face of the text around it", () => {
    // A field draws text — its caption, and in the executed PDF its value —
    // so it needs the run's face the way a page number does, or an export
    // has nothing to print the value in.
    const fonts = new DefaultFontProvider({
      default: { id: "app-sans", family: "App Sans", weight: 400, style: "normal", bytes: () => Promise.resolve(new ArrayBuffer(8)) },
    });
    const editor = createTestEditor({
      extensions: [StarterKit, Field],
      fonts,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Signed: " },
              { type: "field", attrs: { nodeId: "f1", kind: "signature", fill: "signer", role: "client", width: 180, height: 44 } },
            ],
          },
        ],
      },
    });
    editor.ensureFullLayout();

    const span = editor.layout.pages
      .flatMap((page) => page.blocks)
      .flatMap((block) => block.lines)
      .flatMap((line) => line.spans)
      .find((s) => s.kind === "object");

    expect(span).toMatchObject({ kind: "object", width: 180, height: 44 });
    expect(span?.kind === "object" && span.font).toContain("App Sans");
  });
});
