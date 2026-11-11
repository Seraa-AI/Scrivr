/**
 * Fields. The inline field is a box: one a signer completes, which the
 * document never holds a value for, or an author's checkbox, whose state is
 * content like any other.
 */
import { describe, expect, it } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { Field, listSignerFields } from "./Field";
import { createTestEditor } from "../../test-utils";

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

    expect(listSignerFields(editor.getState().doc)).toEqual([{ id: expect.any(String), role: "client", kind: "signature", required: true }]);
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
