/**
 * Fields. The inline field is a box: one a signer completes, which the
 * document never holds a value for, or an author's checkbox, whose state is
 * content like any other.
 */
import { describe, expect, it, vi } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { DOMParser, DOMSerializer, type Node as PmNode } from "prosemirror-model";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { Field, fieldDrawingAt, fieldValues, isFieldAnswered, listSignerFields, paintCheckbox, setFieldValue, unansweredBeforeSigning, valuesOnRecord, type SignerFieldDescriptor } from "./Field";
import { BUILT_IN_FIELD_KINDS, fieldIconStrokes, fieldInk, fieldRoleColor, fieldValueLayout, fieldVerb, type FieldKinds, type FieldValue } from "./fieldKinds";
import { createMeasurer, createTestEditor, measureTextWidth } from "../../test-utils";
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

  it("is not typed over when selected — a signer fills it, not the author — but can be deleted", () => {
    const editor = drafter();
    editor.commands.insertField({ kind: "dropdown", fill: "signer", role: "client", options: [{ id: "net-30", label: "Net 30" }] });
    const select = () => {
      const [box] = fields(editor);
      editor.applyTransaction(editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, box!.pos)));
    };
    select();

    expect(editor.applyTransaction(editor.getState().tr.insertText("Net 30"))).toBe(false);
    expect(fields(editor)).toHaveLength(1);
    expect(editor.getState().doc.textContent).not.toContain("Net 30");

    select();
    editor.applyTransaction(editor.getState().tr.deleteSelection());
    expect(fields(editor)).toEqual([]);
  });

  it("is selected by the first Backspace or Delete beside it, and removed by the second", () => {
    for (const [key, side] of [["Backspace", 1], ["Delete", 0]] as const) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const editor = createTestEditor({ extensions: [StarterKit, Field], content: terms });
      editor.mount(container);
      editor.commands.insertField({ kind: "signature", fill: "signer", role: "client" });
      let at = -1;
      editor.getState().doc.descendants((node, pos) => {
        if (node.type.name === "field") at = pos;
      });
      editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, at + side)));
      const press = () =>
        container.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      const boxes = () => editor.getState().doc.textBetween(0, editor.getState().doc.content.size, "", "□").split("□").length - 1;

      press();
      expect(boxes()).toBe(1);
      expect(editor.getState().selection).toBeInstanceOf(NodeSelection);

      press();
      expect(boxes()).toBe(0);
      editor.destroy();
      container.remove();
    }
  });

  it("lets undo put back the text it replaced while it is selected", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Signed: Client" }] }] },
    });
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, 9, 15)));
    editor.commands.insertField({ kind: "signature", fill: "signer", role: "client" });
    const [field] = fields(editor);
    editor.applyTransaction(editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, field!.pos)));

    editor.commands.undo();

    expect(editor.getState().doc.textContent).toBe("Signed: Client");
    expect(fields(editor)).toHaveLength(0);
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

  it("replaces the whole placeholder with what is typed at its edge, as Word does", () => {
    const editor = withPlaceholder();
    const [placeholder] = ranges(editor);

    editor.applyTransaction(editor.getState().tr.insertText("A", 20));

    expect(ranges(editor)).toEqual([{ text: "A", id: placeholder!.id, placeholder: false }]);
  });

  it("keeps showing the placeholder when part of it is deleted, so it never counts as filled", () => {
    const editor = withPlaceholder();
    const [placeholder] = ranges(editor);

    editor.applyTransaction(editor.getState().tr.delete(19, 20));

    expect(ranges(editor)).toEqual([{ text: "Client name", id: placeholder!.id, placeholder: true }]);
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

  it("stays one field across a line break, as an address does", () => {
    const editor = drafter();
    type(editor, "1 Main St");
    select(editor, 9, 18);
    editor.commands.insertFieldRange({ kind: "text", prompt: "Address" });
    const [address] = ranges(editor);
    caret(editor, 18);

    editor.commands.insertHardBreak();
    type(editor, "Springfield");

    expect(ranges(editor)).toEqual([{ text: "1 Main StSpringfield", id: address!.id, placeholder: false }]);
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

describe("a value typed into a field", () => {
  const box = { x: 100, y: 200, width: 180, height: 24 };

  it("sits on the line like a filled-in blank: on the baseline, in the size of the text around it", () => {
    const set = fieldValueLayout(box, "14px Inter", 220);

    expect(set.baselineY).toBe(220);
    expect(set.sizePx).toBe(14);
    expect(set.font).toBe("14px Inter");
    // Part of the document once filled: no rule, no tag — just the text.
    expect(set).not.toHaveProperty("rule");
  });

});

describe("a field's ink — how an unfilled field is drawn", () => {
  const box = { x: 100, y: 200, width: 180, height: 44 };

  it("gives each party one colour everywhere, and a field the author fills none of theirs", () => {
    expect(fieldRoleColor("client")).toBe(fieldRoleColor("client"));
    expect(fieldRoleColor("client")).not.toBe(fieldRoleColor("provider"));
    expect(fieldRoleColor(null)).toBe(fieldRoleColor(undefined));
  });

  it("sets the label and its icon on the field's line, which runs the box's width", () => {
    const ink = fieldInk(box, 240);

    // The label stands on the text's baseline, the rule just under it, like an underline.
    expect(ink.labelBaselineY).toBe(240);
    expect(ink.rule).toEqual({ from: { x: 100, y: 242 }, to: { x: 280, y: 242 } });
    expect(ink.icon.x + ink.icon.size).toBeLessThan(ink.labelX);
    // Set like a capital letter: standing on the baseline, as tall as the label's capitals.
    expect(ink.icon.y + ink.icon.size).toBe(ink.labelBaselineY);
    expect(ink.icon.size).toBeCloseTo(ink.labelSizePx * 0.72, 0);
  });

  it("names what a signer does, and draws an icon for it", () => {
    expect([fieldVerb("signature", "signatureLine"), fieldVerb("initials", "text"), fieldVerb("date", "date")]).toEqual(["Sign", "Initial", "Date"]);
    expect(fieldVerb("dropdown", "dropdown")).toBe("Choose");
    expect(fieldIconStrokes("signatureLine", { x: 0, y: 0, size: 12 }).length).toBeGreaterThan(0);
    expect(fieldIconStrokes("text", { x: 0, y: 0, size: 12 })).toEqual([]);
  });
});

describe("a host's own look for fields", () => {
  const signer = { nodeId: "s", kind: "signature", fill: "signer", role: "client", width: 180, height: 44 };
  const paintWith = (extension: ReturnType<typeof Field.configure>) => {
    const editor = new ServerEditor({ extensions: [StarterKit, extension] });
    const node = editor.schema.nodes["field"]!.create(signer);
    const ctx = document.createElement("canvas").getContext("2d")!;
    const fillText = vi.spyOn(ctx, "fillText");
    editor.inlineRegistry.get("field")!.render(ctx, 10, 20, 180, 44, node, editor.getResolvedTheme(), { baselineY: 64 });
    return fillText.mock.calls.length;
  };

  it("lets the host draw a field itself, handed what Scrivr knows about it", () => {
    const paint = vi.fn(() => true);
    const drawnByScrivr = paintWith(Field.configure({ paint }));

    expect(paint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "signature", control: "signatureLine", label: "Signature", role: "client", baselineY: 64, box: { x: 10, y: 20, width: 180, height: 44 } }),
    );
    expect(drawnByScrivr).toBe(0);
  });

  it("draws Scrivr's own look when the host declines", () => {
    expect(paintWith(Field.configure({ paint: () => false }))).toBeGreaterThan(0);
  });

  it("colours a party as the host says, everywhere it is drawn", () => {
    expect(fieldRoleColor("client", { client: "#ff0000" })).toBe("#ff0000");
    expect(fieldRoleColor("provider", { client: "#ff0000" })).toBe(fieldRoleColor("provider"));
  });
});

describe("a field's box on the page", () => {
  it("is as tall as the text when it holds text, so a line keeps its height, as a Word content control does", () => {
    const editor = createTestEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Payable on terms of " },
              { type: "field", attrs: { nodeId: "terms", kind: "name", fill: "signer", role: "client", width: 140, height: 24 } },
              { type: "text", text: " from the date of invoice." },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "Payable on terms of Net 30 from the date of invoice." }] },
        ],
      },
    });
    editor.ensureFullLayout();
    const [withField, plain] = editor.layout.pages[0]!.blocks.map((block) => block.lines[0]!);
    const field = withField!.spans.find((span) => span.kind === "object");

    expect(field?.width).toBe(140);
    expect(withField!.lineHeight).toBe(plain!.lineHeight);
    // It fills the line as a word does — above the baseline and below it — so
    // its descenders and rule sit inside its own box.
    expect(field?.kind === "object" && field.verticalAlign).toBe("text-bottom");
    expect(field?.height).toBeGreaterThan(withField!.textAscent);
    editor.destroy();
  });

  const laidOutField = (field: Record<string, unknown>, extension: typeof Field | ReturnType<typeof Field.configure> = Field) => {
    const editor = createTestEditor({
      extensions: [StarterKit, extension],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms: " }, { type: "field", attrs: field }] }] },
    });
    editor.ensureFullLayout();
    const span = editor.layout.pages[0]!.blocks[0]!.lines[0]!.spans.find((s) => s.kind === "object");
    const font = span?.kind === "object" ? span.font : undefined;
    editor.destroy();
    return { width: span?.width ?? 0, font: font ?? "" };
  };

  it("is as wide as a dropdown's widest choice, so whichever is chosen fills it", () => {
    const options = [{ id: "net-15", label: "Net 15" }, { id: "net-60", label: "Net 60 days" }];
    const { width, font } = laidOutField({ nodeId: "t", kind: "dropdown", fill: "signer", role: "client", options, width: 300, height: 24 });

    expect(width).toBeLessThan(300);
    expect(width).toBeGreaterThanOrEqual(measureTextWidth("Net 60 days", font));
  });

  it("fits a value it is printed with — the executed document has no gaps", () => {
    const attrs = { nodeId: "who", kind: "name", fill: "signer", role: "client", width: 300, height: 24 };
    const blank = laidOutField(attrs);
    const signed = laidOutField(attrs, Field.configure({ values: { who: { kind: "text", text: "Ada" } } }));

    expect(blank.width).toBe(300);
    expect(signed.width).toBeLessThan(blank.width);
    expect(signed.width).toBeGreaterThanOrEqual(measureTextWidth("Ada", signed.font));
  });

  it("fits a value given once it is laid out, and the line closes up around it", () => {
    const editor = createTestEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms: " }, { type: "field", attrs: { nodeId: "who", kind: "name", fill: "signer", role: "client", width: 300, height: 24 } }] }] },
      sealed: true,
    });
    const width = () => {
      editor.ensureFullLayout();
      const span = editor.layout.pages[0]!.blocks[0]!.lines[0]!.spans.find((s) => s.kind === "object");
      return { width: span?.width ?? 0, font: span?.kind === "object" ? (span.font ?? "") : "" };
    };
    const doc = editor.getState().doc;
    expect(width().width).toBe(300);

    // A sealed document takes the value: it is held beside the document, not in it.
    expect(setFieldValue(editor, "who", { kind: "text", text: "Ada" })).toBe(true);
    const filled = width();

    expect(editor.getState().doc).toBe(doc);
    expect(fieldValues(editor.getState())).toEqual({ who: { kind: "text", text: "Ada" } });
    expect(filled.width).toBeLessThan(300);
    expect(filled.width).toBeGreaterThanOrEqual(measureTextWidth("Ada", filled.font));

    setFieldValue(editor, "who", null);
    expect(width().width).toBe(300);
    editor.destroy();
  });

  it("keeps the space its author left while its value is blank", () => {
    const attrs = { nodeId: "who", kind: "name", fill: "signer", role: "client", width: 300, height: 24 };

    expect(laidOutField(attrs, Field.configure({ values: { who: { kind: "text", text: "   " } } })).width).toBe(300);
  });

  it("is a checkbox about as tall as the text's capitals and ascenders, as a native one sits by its label", () => {
    const { width, font } = laidOutField({ nodeId: "ok", kind: "checkbox", fill: "signer", role: "client", width: 16, height: 16 });
    // Against the face's own ascent, measured as layout measures it — whatever font the machine has.
    const { ascent } = createMeasurer().getFontMetrics(font);

    expect(width).toBeGreaterThanOrEqual(ascent * 0.9);
    expect(width).toBeLessThanOrEqual(ascent + 1);
  });

  it("keeps a dropdown's choice by its id, and sets the label a person reads", () => {
    const options = [{ id: "net-15", label: "Net 15" }, { id: "net-60", label: "Net 60 days" }];
    const attrs = { nodeId: "t", kind: "dropdown", fill: "signer", role: "client", options, width: 300, height: 24 };
    const chosen = laidOutField(attrs, Field.configure({ values: { t: { kind: "choice", id: "net-15" } } }));

    expect(chosen.width).toBeGreaterThanOrEqual(measureTextWidth("Net 15", chosen.font));
    expect(chosen.width).toBeLessThan(measureTextWidth("Net 60 days", chosen.font));
  });

  it("leaves a dropdown empty when its choice is no longer offered", () => {
    const options = [{ id: "net-15", label: "Net 15" }];
    const attrs = { nodeId: "t", kind: "dropdown", fill: "signer", role: "client", options, width: 300, height: 24 };

    expect(laidOutField(attrs, Field.configure({ values: { t: { kind: "choice", id: "gone" } } })).width).toBe(laidOutField(attrs).width);
  });

  it("sets a typed signature as text, fitted to it, rather than in the signature's box", () => {
    const attrs = { nodeId: "sig", kind: "signature", fill: "signer", role: "client", width: 180, height: 44 };
    const typed = laidOutField(attrs, Field.configure({ values: { sig: { kind: "text", text: "Ada Lovelace" } } }));

    expect(typed.width).toBeGreaterThanOrEqual(measureTextWidth("Ada Lovelace", typed.font));
    expect(typed.width).toBeLessThan(measureTextWidth("Ada Lovelace", typed.font) + 6);
  });

  it("takes formatting like the text it sits in — a bold field prints its value bold", () => {
    const editor = createTestEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Terms: " }, { type: "field", attrs: { nodeId: "t", kind: "name", fill: "signer", role: "client", width: 140, height: 24 } }] }] },
    });
    editor.applyTransaction(editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, 8)));

    editor.commands.toggleBold();
    editor.ensureFullLayout();

    expect(editor.getState().doc.nodeAt(8)?.marks.map((m) => m.type.name)).toEqual(["bold"]);
    const span = editor.layout.pages[0]!.blocks[0]!.lines[0]!.spans.find((s) => s.kind === "object");
    expect(span?.kind === "object" && span.font).toMatch(/bold|700/);
    editor.destroy();
  });

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

describe("text an author filled, under the pointer", () => {
  const range = (nodeId: string, prompt: string) => ({ type: "fieldRange", attrs: { nodeId, kind: "text", prompt } });

  it("is hovered as one field over its whole text, next to another field it touches", () => {
    const editor = createTestEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Between " },
              { type: "text", text: "Acme ", marks: [range("client", "Client name")] },
              { type: "text", text: "Ltd", marks: [{ type: "bold" }, range("client", "Client name")] },
              { type: "text", text: "Kenya", marks: [range("where", "Country")] },
            ],
          },
        ],
      },
    });
    editor.ensurePagePopulated(1);
    const from = 1 + "Between ".length;
    const at = editor.charMap.coordsAtPos(from + 6)!;
    const next = editor.charMap.coordsAtPos(from + 7)!;

    const targets = editor.resolveHoverTargets({ page: at.page, x: (at.x + next.x) / 2, y: at.y + at.height / 2, region: "content" });

    expect(targets).toEqual([{ kind: "fieldRange", surfaceId: "body", pos: from, end: from + "Acme Ltd".length, at: from + 6 }]);
    editor.destroy();
  });
});

describe("what a party completes before they sign", () => {
  const field = (id: string, kind: string, extra: Partial<SignerFieldDescriptor> = {}): SignerFieldDescriptor => ({
    id,
    role: "client",
    kind,
    required: true,
    options: [],
    ...extra,
  });
  const terms = field("terms", "dropdown", { options: [{ id: "net-30", label: "Net 30" }] });
  const agree = field("agree", "checkbox");
  const name = field("name", "name");
  const fields = [
    terms,
    agree,
    name,
    field("email", "email", { required: false }),
    field("initials", "initials"),
    field("sig", "signature"),
    field("dated", "dateSigned"),
    field("other", "name", { role: "provider" }),
  ];

  it("is every required field of theirs but the signature and the date it is signed", () => {
    expect(unansweredBeforeSigning(fields, {}, "client", BUILT_IN_FIELD_KINDS).map((f) => f.id)).toEqual(["terms", "agree", "name", "initials"]);
    expect(
      unansweredBeforeSigning(
        fields,
        {
          terms: { kind: "choice", id: "net-30" },
          agree: { kind: "checkbox", checked: true },
          name: { kind: "text", text: "Ada" },
          initials: { kind: "text", text: "AL" },
        },
        "client",
        BUILT_IN_FIELD_KINDS,
      ),
    ).toEqual([]);
  });

  it("knows a host's own signature, and its own dated kind, by what they declare", () => {
    const kinds = {
      ...BUILT_IN_FIELD_KINDS,
      witness: { label: "Witness", size: { width: 180, height: 44 }, control: "signatureLine" },
      stamped: { label: "Stamped on", size: { width: 110, height: 24 }, control: "date", datedWhenSigned: true },
    } satisfies FieldKinds;

    expect(unansweredBeforeSigning([field("w", "witness"), field("s", "stamped"), name], {}, "client", kinds)).toEqual([name]);
  });

  it("counts an unticked box, a choice no longer offered, or blank text as unanswered", () => {
    const kinds = BUILT_IN_FIELD_KINDS;
    expect(isFieldAnswered(agree, { kind: "checkbox", checked: false }, kinds)).toBe(false);
    expect(isFieldAnswered(terms, { kind: "choice", id: "net-90" }, kinds)).toBe(false);
    expect(isFieldAnswered(name, { kind: "text", text: "  " }, kinds)).toBe(false);
    expect(isFieldAnswered(name, undefined, kinds)).toBe(false);
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: "data:image/png;base64,AA==" }, kinds)).toBe(true);
  });

  it("counts only a value the field can show — what an executed record would print", () => {
    const kinds = BUILT_IN_FIELD_KINDS;
    // A checkbox shows a tick, not words; a drawing must be one the page may draw.
    expect(isFieldAnswered(agree, { kind: "text", text: "yes" }, kinds)).toBe(false);
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: "data:image/svg+xml;base64,PHN2Zy8+" }, kinds)).toBe(false);
    expect(isFieldAnswered(field("sig", "signature"), { kind: "text", text: "Ada Lovelace" }, kinds)).toBe(true);
  });

  it("takes a drawing only on a field that is drawn, and only as an inline PNG or JPEG the record can print", () => {
    const kinds = BUILT_IN_FIELD_KINDS;
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: png }, kinds)).toBe(true);
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: "data:image/jpeg;base64,/9j/" }, kinds)).toBe(true);
    expect(isFieldAnswered(field("ini", "initials"), { kind: "image", src: png }, kinds)).toBe(true);
    // A link can change after signing, and an SVG cannot be printed.
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: "https://example.com/sig.png" }, kinds)).toBe(false);
    expect(isFieldAnswered(field("sig", "signature"), { kind: "image", src: "https://example.com/sig.svg" }, kinds)).toBe(false);
    // A name is words: a drawing would be squeezed into a line of text.
    expect(isFieldAnswered(name, { kind: "image", src: png }, kinds)).toBe(false);
  });
});

describe("the values a record shows", () => {
  const signer = (id: string, kind: string, required = true): SignerFieldDescriptor => ({ id, role: "client", kind, required, options: [] });
  const fields = [signer("sig", "signature", false), signer("dated", "dateSigned", false), signer("name", "name")];
  const date: FieldValue = { kind: "text", text: "14 November 2026" };

  it("keep a date signed only beside an answered signature of its party", () => {
    const signed = { sig: { kind: "text", text: "Ada" }, dated: date, name: { kind: "text", text: "Ada" } } satisfies Record<string, FieldValue>;
    const blanked = { ...signed, sig: { kind: "text", text: "  " } } satisfies Record<string, FieldValue>;

    expect(valuesOnRecord(fields, signed, BUILT_IN_FIELD_KINDS)).toEqual(signed);
    expect(valuesOnRecord(fields, blanked, BUILT_IN_FIELD_KINDS)).toEqual({ sig: blanked.sig, name: blanked.name });
  });
});

describe("a value Field holds", () => {
  const pageWith = (attrs: Record<string, unknown>, values: Record<string, FieldValue>) => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field.configure({ values })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "field", attrs }] }] },
    });
    const at = { box: { x: 0, y: 0, width: 16, height: 16 }, baselineY: 16, theme: editor.getResolvedTheme() };
    return fieldDrawingAt(editor, 1, at);
  };

  it("is a signer's, never laid over what the author sealed — an author's ticked box stays ticked", () => {
    const drawing = pageWith({ nodeId: "agreed", kind: "checkbox", fill: "author", checked: true }, { agreed: { kind: "checkbox", checked: false } });

    expect(drawing?.value).toBeUndefined();
    expect(drawing?.node.attrs["checked"]).toBe(true);
  });

  it("is one the field can show, or none — no words in a checkbox", () => {
    const drawing = pageWith({ nodeId: "ok", kind: "checkbox", fill: "signer", role: "client" }, { ok: { kind: "text", text: "yes" } });

    expect(drawing?.value).toBeUndefined();
  });
});

describe("a checkbox, drawn as a native one", () => {
  /** What was filled and stroked, in which colour and at what opacity. */
  const drawing = (look: Parameters<typeof paintCheckbox>[2]) => {
    const marks: string[] = [];
    const state: Record<string, unknown> = { globalAlpha: 1 };
    const isContext = (value: unknown): value is CanvasRenderingContext2D => typeof value === "object" && value !== null;
    const ctx: unknown = new Proxy(state, {
      get: (target, key) =>
        typeof key !== "string"
          ? undefined
          : key in target
            ? target[key]
            : (..._args: unknown[]) => {
                if (key === "fill") marks.push(`fill ${String(target["fillStyle"])} @${String(target["globalAlpha"])}`);
                if (key === "stroke") marks.push(`stroke ${String(target["strokeStyle"])}`);
              },
      set: (target, key, value) => {
        if (typeof key === "string") target[key] = value;
        return true;
      },
    });
    if (!isContext(ctx)) throw new Error("no context");
    paintCheckbox(ctx, { x: 0, y: 0, width: 15, height: 15 }, look);
    return marks;
  };

  it("is an outlined box on the page until checked, then filled in its colour with a white tick", () => {
    expect(drawing({ checked: false, color: "#0e7490", pageBg: "#fff" })).toEqual(["fill #fff @1", "stroke #0e7490"]);
    expect(drawing({ checked: true, color: "#0e7490", pageBg: "#fff" })).toEqual(["fill #0e7490 @1", "stroke #ffffff"]);
  });

  it("tints an empty box under the pointer", () => {
    expect(drawing({ checked: false, color: "#0e7490", pageBg: "#fff", hover: true })).toEqual([
      "fill #fff @1",
      "fill #0e7490 @0.12",
      "stroke #0e7490",
    ]);
  });
});
