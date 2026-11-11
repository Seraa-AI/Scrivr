/**
 * Fields through DOCX. Every field travels as a content control carrying
 * Scrivr's metadata in its tag, so it comes back as the same field; a
 * signature's content is Word's own signature line, so Word can sign it.
 * Checked against [MS-OE376]: Office reads `issignatureline` as false unless
 * written, and discards all but the last of two controls sharing a `w:id`.
 */
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { Field, ServerEditor, StarterKit, listSignerFields } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { exportDocxBytes } from "./export/export";
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

  it("keeps a text field over mixed formatting in one control", async () => {
    const { document } = await exported();

    expect(document.match(/scrivr:fieldRange:/g)).toHaveLength(1);
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
