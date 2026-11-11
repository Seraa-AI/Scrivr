/**
 * Fields through DOCX. Every field travels as a content control carrying
 * Scrivr's metadata in its tag, so it comes back as the same field; a
 * signature's content is Word's own signature line, so Word can sign it.
 * Checked against [MS-OE376]: Office reads `issignatureline` as false unless
 * written, and discards all but the last of two controls sharing a `w:id`.
 */
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
import { Extension, Field, ServerEditor, StarterKit, listSignerFields } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { exportDocx, exportDocxBytes } from "./export/export";
import { importDocx } from "./import/import";

const extensions = [StarterKit, Field];

const signer = (kind: string, role: string) => ({
  type: "field",
  attrs: { nodeId: crypto.randomUUID(), kind, fill: "signer", role, required: true, width: 180, height: 44 },
});

const contract = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Client: " },
        {
          type: "text",
          text: "Acme ",
          marks: [{ type: "fieldRange", attrs: { nodeId: "range-1", kind: "text", prompt: "Client name", placeholder: false } }],
        },
        {
          type: "text",
          text: "Ltd",
          marks: [
            { type: "bold" },
            { type: "fieldRange", attrs: { nodeId: "range-1", kind: "text", prompt: "Client name", placeholder: false } },
          ],
        },
      ],
    },
    {
      type: "fieldBlock",
      attrs: { nodeId: "block-1", kind: "text", prompt: "Special terms" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Net 30." }] }],
    },
    {
      type: "paragraph",
      content: [
        signer("signature", "client"),
        signer("initials", "client"),
        signer("date", "client"),
        { type: "field", attrs: { nodeId: crypto.randomUUID(), kind: "checkbox", fill: "author", checked: true, width: 16, height: 16 } },
      ],
    },
  ],
};

async function exported() {
  const editor = new ServerEditor({ extensions, content: contract });
  const bytes = await exportDocxBytes(editor);
  const document = strFromU8(unzipSync(bytes)["word/document.xml"]!);
  return { editor, bytes, document };
}

const fieldsOf = (doc: PmNode) => {
  const out: Array<Record<string, unknown>> = [];
  doc.descendants((node) => {
    if (node.type.name === "field") {
      const { kind, fill, role, required, checked } = node.attrs;
      out.push({ kind, fill, role, required, checked });
    }
  });
  return out;
};

describe("fields in DOCX", () => {
  it("writes a signature as Word's signature line, flagged so Office treats it as one", async () => {
    const { document } = await exported();

    expect(document).toMatch(/<o:signatureline [^>]*issignatureline="t"/);
    expect(document).toMatch(/<o:signatureline [^>]*id="\{[0-9A-F-]{36}\}"/);
    expect(document).toMatch(/<o:signatureline [^>]*o:suggestedsigner2="client"/);
  });

  it("gives every content control its own w:id", async () => {
    const { document } = await exported();
    const ids = [...document.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);

    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exports every field without a warning — a text field wraps its runs, which is all it needs", async () => {
    const { diagnostics } = await exportDocx(new ServerEditor({ extensions, content: contract }));

    expect(diagnostics).toEqual([]);
  });

  it("keeps a text field over mixed formatting in one control", async () => {
    const { document } = await exported();

    expect(document.match(/scrivr:fieldRange:/g)).toHaveLength(1);
  });

  it("keeps a text field across a line break in one control", async () => {
    const range = [{ type: "fieldRange", attrs: { nodeId: "address", kind: "text", prompt: "Address", placeholder: false } }];
    const editor = new ServerEditor({
      extensions,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "1 Main St", marks: range },
              { type: "hardBreak", marks: range },
              { type: "text", text: "Springfield", marks: range },
            ],
          },
        ],
      },
    });
    const document = strFromU8(unzipSync(await exportDocxBytes(editor))["word/document.xml"]!);

    expect(document.match(/scrivr:fieldRange:/g)).toHaveLength(1);
    expect(document).toMatch(/<w:sdtContent>.*1 Main St.*<w:br\/>.*Springfield.*<\/w:sdtContent>/);

    const { doc } = await importDocx(new ServerEditor({ extensions }), await exportDocxBytes(editor));
    const marked = doc.child(0).content.content.map((node) => node.marks.some((m) => m.attrs["nodeId"] === "address"));
    expect(marked).toEqual([true, true, true]);
  });

  it("writes an author's checkbox as Word's checkbox, checked", async () => {
    const { document } = await exported();

    expect(document).toMatch(/<w14:checkbox[^>]*>.*?<w14:checked w14:val="1"\/>/);
  });

  it("comes back as the same fields", async () => {
    const { editor, bytes } = await exported();
    const { doc } = await importDocx(new ServerEditor({ extensions }), bytes);

    expect(fieldsOf(doc)).toEqual(fieldsOf(editor.getState().doc));
    expect(listSignerFields(doc).map((f) => [f.role, f.kind])).toEqual(
      listSignerFields(editor.getState().doc).map((f) => [f.role, f.kind]),
    );
  });

  it("brings a text field back whole, with its prompt, and a block field around its paragraph", async () => {
    const { bytes } = await exported();
    const { doc } = await importDocx(new ServerEditor({ extensions }), bytes);

    let rangeText = "";
    let prompt: unknown = null;
    doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === "fieldRange");
      if (node.isText && mark) {
        rangeText += node.text;
        prompt = mark.attrs["prompt"];
      }
    });
    expect(rangeText).toBe("Acme Ltd");
    expect(prompt).toBe("Client name");
    expect(doc.child(1).type.name).toBe("fieldBlock");
    expect(doc.child(1).textContent).toBe("Net 30.");
  });

  it("brings the ids back, so a host's records still point at its fields", async () => {
    const { editor, bytes } = await exported();
    const { doc } = await importDocx(new ServerEditor({ extensions }), bytes);

    expect(listSignerFields(doc).map((f) => f.id)).toEqual(listSignerFields(editor.getState().doc).map((f) => f.id));
  });
});

describe("content controls Scrivr did not write", () => {
  /** A Word file whose body is `paragraph`, built on an exported package. */
  const wordFile = async (paragraph: string) => {
    const files = unzipSync(await exportDocxBytes(new ServerEditor({ extensions })));
    const document = strFromU8(files["word/document.xml"]!).replace(/<w:body>.*<\/w:body>/s, `<w:body>${paragraph}</w:body>`);
    return zipSync({ ...files, "word/document.xml": strToU8(document) });
  };
  const control = (tag: string, text: string, showingPrompt: boolean) =>
    `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${showingPrompt ? "<w:showingPlcHdr/>" : ""}</w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`;

  it("keeps what was typed into one, and leaves out Word's prompt in one nobody filled", async () => {
    const bytes = await wordFile(
      `<w:p><w:r><w:t xml:space="preserve">Client: </w:t></w:r>${control("crm-client", "Acme", false)}` +
        `<w:r><w:t xml:space="preserve"> Ref: </w:t></w:r>${control("crm-ref", "Click or tap here to enter text.", true)}</w:p>`,
    );
    const { doc } = await importDocx(new ServerEditor({ extensions }), bytes);

    expect(doc.textContent).toBe("Client: Acme Ref: ");
  });

  it("is read by whichever extension owns its tag, beside Field's own", async () => {
    // A host's own control, kept as a highlight — one more owner of `<w:sdt>`.
    const CrmControls = Extension.create({
      name: "crmControls",
      addImports() {
        return {
          docx: {
            marks: {
              sdt: (mark, ctx) =>
                mark.attrs?.["tag"] === "crm-client" ? (ctx.schema.marks["highlight"]?.create() ?? null) : null,
            },
          },
        };
      },
    });
    const range = [{ type: "fieldRange", attrs: { nodeId: "range-1", kind: "text", prompt: "Name", placeholder: false } }];
    const ours = await exportDocxBytes(
      new ServerEditor({ extensions, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ada", marks: range }] }] } }),
    );
    const files = unzipSync(ours);
    const document = strFromU8(files["word/document.xml"]!).replace("</w:p>", `${control("crm-client", "Acme", false)}</w:p>`);
    const bytes = zipSync({ ...files, "word/document.xml": strToU8(document) });

    const { doc } = await importDocx(new ServerEditor({ extensions: [...extensions, CrmControls] }), bytes);
    const marksOf = (text: string) => {
      let names: string[] = [];
      doc.descendants((node) => {
        if (node.text === text) names = node.marks.map((m) => m.type.name);
      });
      return names;
    };

    expect(marksOf("Ada")).toEqual(["fieldRange"]);
    expect(marksOf("Acme")).toEqual(["highlight"]);
  });
});

describe("kinds of field in DOCX", () => {
  const withKinds = [StarterKit, Field.configure({ kinds: { stamp: { label: "Company stamp", size: { width: 120, height: 120 } } } })];
  const doc = (attrs: Record<string, unknown>) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "field", attrs: { nodeId: crypto.randomUUID(), fill: "signer", role: "client", ...attrs } }] }],
  });

  it("writes a dropdown as Word's dropdown, and reads its choices back", async () => {
    const editor = new ServerEditor({ extensions, content: doc({ kind: "dropdown", options: [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }] }) });
    const bytes = await exportDocxBytes(editor);
    const document = strFromU8(unzipSync(bytes)["word/document.xml"]!);

    expect(document).toMatch(
      /<w:dropDownList>.*?w:displayText="Net 30" w:value="net-30".*?w:displayText="Net 60" w:value="net-60".*?<\/w:dropDownList>/,
    );
    const { doc: back } = await importDocx(new ServerEditor({ extensions }), bytes);
    let options: unknown = null;
    back.descendants((node) => {
      if (node.type.name === "field") options = node.attrs["options"];
    });
    expect(options).toEqual([{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }]);
  });

  it("keeps a host's own kind, sent to Word as a text control", async () => {
    const editor = new ServerEditor({ extensions: withKinds, content: doc({ kind: "stamp", width: 120, height: 120 }) });
    const bytes = await exportDocxBytes(editor);

    expect(strFromU8(unzipSync(bytes)["word/document.xml"]!)).toMatch(/<w:sdtPr>.*?<w:text\/>/);
    const { doc: back } = await importDocx(new ServerEditor({ extensions: withKinds }), bytes);
    expect(listSignerFields(back).map((f) => f.kind)).toEqual(["stamp"]);
  });
});
