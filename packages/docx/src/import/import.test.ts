/**
 * Import smoke tests. Round-trips through `exportDocx`: build a known doc,
 * serialize → bytes, parse bytes → ProseMirror `Node`, assert structure
 * matches.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import { DocxImportError } from "./error";

/** Walk a paragraph's inline children, returning their type names. */
function inlineTypes(para: PmNode): string[] {
  const out: string[] = [];
  para.content.forEach((child) => out.push(child.type.name));
  return out;
}

/** Read a paragraph's textContent. */
function textOf(para: PmNode): string {
  return para.textContent;
}

describe("importDocx — MVP (paragraph + text)", () => {
  it("returns { doc: Node, diagnostics: [] } for a one-paragraph doc", async () => {
    const editor = new ServerEditor({ content: "hello" });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const result = await importDocx(importer, bytes);

    expect(result).toHaveProperty("doc");
    expect(result).toHaveProperty("diagnostics");
    expect(result.doc.type.name).toBe("doc");
    expect(result.doc.childCount).toBeGreaterThan(0);
  });

  it("recovers paragraph text from a one-paragraph doc", async () => {
    const editor = new ServerEditor({ content: "hello world" });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);

    expect(doc.childCount).toBe(1);
    const para = doc.child(0);
    expect(para.type.name).toBe("paragraph");
    expect(textOf(para)).toBe("hello world");
  });

  it("preserves multiple paragraphs in document order", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
        { type: "paragraph", content: [{ type: "text", text: "third" }] },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);

    const texts: string[] = [];
    doc.forEach((para) => texts.push(textOf(para)));
    expect(texts).toEqual(["first", "second", "third"]);
  });

  it("preserves edge whitespace via xml:space=preserve on w:t", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "  leading and trailing  " }],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    expect(textOf(doc.child(0))).toBe("  leading and trailing  ");
  });

  it("recovers hard breaks (Shift-Enter inside a paragraph)", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before" },
            { type: "hardBreak" },
            { type: "text", text: "after" },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    expect(inlineTypes(doc.child(0))).toEqual(["text", "hardBreak", "text"]);
  });

  it("emits at least one paragraph for an effectively empty doc", async () => {
    const editor = new ServerEditor();
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    expect(doc.childCount).toBeGreaterThan(0);
    expect(doc.child(0).type.name).toBe("paragraph");
  });

  it("throws DocxImportError on malformed bytes", async () => {
    const importer = new ServerEditor();
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    await expect(importDocx(importer, garbage)).rejects.toThrow(DocxImportError);
  });

  it("throws DocxImportError when document.xml is missing", async () => {
    const importer = new ServerEditor();
    const { zipSync, strToU8 } = await import("fflate");
    const bytes = zipSync({
      "not-a-docx.txt": strToU8("hello"),
    });
    await expect(importDocx(importer, bytes)).rejects.toThrow(
      /word\/document\.xml/,
    );
  });
});

describe("importDocx — extension dispatch", () => {
  it("invokes the editor's getImportContributions for marks", async () => {
    // Round-trip with bold — without a Bold extension's addImports, the
    // mark is dropped. We'll wire the real one in the next commit;
    // here we override per-call to assert the dispatch lane works.
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);

    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes, {
      overrides: {
        marks: {
          b(_mark, ctx) {
            const t = ctx.schema.marks["bold"];
            return t ? t.create() : null;
          },
        },
      },
    });
    const para = doc.child(0);
    const run = para.child(0);
    expect(run.type.name).toBe("text");
    expect(run.marks.map((m) => m.type.name)).toEqual(["bold"]);
  });
});
