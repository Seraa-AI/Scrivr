/**
 * Import smoke tests. Round-trips through `exportDocx`: build a known doc,
 * serialize → bytes, parse bytes → ProseMirror `Node`, assert structure
 * matches.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
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

describe("importDocx — built-in mark round-trips via StarterKit", () => {
  /**
   * Round-trip a doc with the given marks through exportDocx → importDocx
   * and return the imported run's mark type names.
   */
  async function roundTripMarks(
    text: string,
    markSpecs: Array<{ type: string; attrs?: Record<string, unknown> }>,
  ): Promise<{ types: string[]; attrs: Record<string, Record<string, unknown>> }> {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text, marks: markSpecs }],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    const run = doc.child(0).child(0);
    const attrs: Record<string, Record<string, unknown>> = {};
    for (const m of run.marks) attrs[m.type.name] = m.attrs;
    return { types: run.marks.map((m) => m.type.name), attrs };
  }

  it("bold round-trips", async () => {
    const r = await roundTripMarks("x", [{ type: "bold" }]);
    expect(r.types).toContain("bold");
  });

  it("italic round-trips", async () => {
    const r = await roundTripMarks("x", [{ type: "italic" }]);
    expect(r.types).toContain("italic");
  });

  it("underline round-trips", async () => {
    const r = await roundTripMarks("x", [{ type: "underline" }]);
    expect(r.types).toContain("underline");
  });

  it("strikethrough round-trips", async () => {
    const r = await roundTripMarks("x", [{ type: "strikethrough" }]);
    expect(r.types).toContain("strikethrough");
  });

  it("color round-trips as #RRGGBB", async () => {
    const r = await roundTripMarks("x", [
      { type: "color", attrs: { color: "#ff0000" } },
    ]);
    expect(r.types).toContain("color");
    expect(r.attrs["color"]?.["color"]).toBe("#FF0000");
  });

  it("fontSize round-trips through half-points conversion", async () => {
    // 18px → 27 half-points → back to 18px.
    const r = await roundTripMarks("x", [
      { type: "fontSize", attrs: { size: 18 } },
    ]);
    expect(r.types).toContain("fontSize");
    expect(r.attrs["fontSize"]?.["size"]).toBe(18);
  });

  it("fontFamily round-trips", async () => {
    const r = await roundTripMarks("x", [
      { type: "fontFamily", attrs: { family: "Georgia" } },
    ]);
    expect(r.types).toContain("fontFamily");
    expect(r.attrs["fontFamily"]?.["family"]).toBe("Georgia");
  });
});

describe("importDocx — structural block round-trips", () => {
  async function roundTrip(content: Array<Record<string, unknown>>): Promise<PmNode> {
    const editor = new ServerEditor();
    editor.setContent({ type: "doc", content });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    return doc;
  }

  it("headings round-trip with their level", async () => {
    const doc = await roundTrip([
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Big" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Smaller" }] },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    ]);
    const types = [doc.child(0), doc.child(1), doc.child(2)].map((c) => ({
      type: c.type.name,
      level: c.attrs["level"],
    }));
    expect(types[0]?.type).toBe("heading");
    expect(types[0]?.level).toBe(1);
    expect(types[1]?.type).toBe("heading");
    expect(types[1]?.level).toBe(3);
    expect(types[2]?.type).toBe("paragraph");
  });

  it("code blocks round-trip as codeBlock nodes with text content", async () => {
    const doc = await roundTrip([
      {
        type: "codeBlock",
        content: [{ type: "text", text: "const x = 1;\nconst y = 2;" }],
      },
    ]);
    const cb = doc.child(0);
    expect(cb.type.name).toBe("codeBlock");
    expect(cb.textContent).toBe("const x = 1;\nconst y = 2;");
  });

  it("page breaks round-trip", async () => {
    const doc = await roundTrip([
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "pageBreak" },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ]);
    const types = [doc.child(0), doc.child(1), doc.child(2)].map((c) => c.type.name);
    expect(types).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("horizontalRule round-trips (empty paragraph + bottom border ⇒ horizontalRule)", async () => {
    const doc = await roundTrip([
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "horizontalRule" },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ]);
    const types = [doc.child(0), doc.child(1), doc.child(2)].map((c) => c.type.name);
    expect(types).toEqual(["paragraph", "horizontalRule", "paragraph"]);
  });
});

describe("importDocx — lists", () => {
  async function roundTripDoc(content: Array<Record<string, unknown>>): Promise<PmNode> {
    const editor = new ServerEditor();
    editor.setContent({ type: "doc", content });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor();
    const { doc } = await importDocx(importer, bytes);
    return doc;
  }

  it("bullet lists reconstruct into bulletList > listItem > paragraph", async () => {
    const doc = await roundTripDoc([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }] },
        ],
      },
    ]);
    expect(doc.childCount).toBe(1);
    const list = doc.child(0);
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(2);
    expect(list.child(0).type.name).toBe("listItem");
    expect(list.child(0).child(0).type.name).toBe("paragraph");
    expect(list.child(0).textContent).toBe("alpha");
    expect(list.child(1).textContent).toBe("beta");
  });

  it("ordered lists reconstruct into orderedList", async () => {
    const doc = await roundTripDoc([
      {
        type: "orderedList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] },
        ],
      },
    ]);
    const list = doc.child(0);
    expect(list.type.name).toBe("orderedList");
    expect(list.childCount).toBe(3);
    const texts: string[] = [];
    list.forEach((item) => texts.push(item.textContent));
    expect(texts).toEqual(["one", "two", "three"]);
  });

  it("nested lists reconstruct under their parent item", async () => {
    const doc = await roundTripDoc([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "outer" }] },
              {
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "inner" }] }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const list = doc.child(0);
    expect(list.type.name).toBe("bulletList");
    const firstItem = list.child(0);
    expect(firstItem.type.name).toBe("listItem");
    // listItem should now contain a paragraph + a nested bulletList
    expect(firstItem.childCount).toBe(2);
    expect(firstItem.child(0).type.name).toBe("paragraph");
    expect(firstItem.child(0).textContent).toBe("outer");
    expect(firstItem.child(1).type.name).toBe("bulletList");
    expect(firstItem.child(1).child(0).textContent).toBe("inner");
  });

  it("mixed nested lists (bullet outer, ordered inner) preserve nesting", async () => {
    const doc = await roundTripDoc([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "outer-a" }] },
              {
                type: "orderedList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "inner-1" }] }] },
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "inner-2" }] }] },
                ],
              },
            ],
          },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "outer-b" }] }] },
        ],
      },
    ]);
    // Should stay as a single top-level bulletList with the orderedList
    // nested inside the first item — not split into three top-level lists.
    expect(doc.childCount).toBe(1);
    const outer = doc.child(0);
    expect(outer.type.name).toBe("bulletList");
    expect(outer.childCount).toBe(2);

    const firstItem = outer.child(0);
    expect(firstItem.type.name).toBe("listItem");
    expect(firstItem.childCount).toBe(2);
    expect(firstItem.child(0).textContent).toBe("outer-a");
    const inner = firstItem.child(1);
    expect(inner.type.name).toBe("orderedList");
    expect(inner.childCount).toBe(2);
    expect(inner.child(0).textContent).toBe("inner-1");
    expect(inner.child(1).textContent).toBe("inner-2");

    expect(outer.child(1).textContent).toBe("outer-b");
  });

  it("list ends cleanly when followed by non-list paragraphs", async () => {
    const doc = await roundTripDoc([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ]);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("bulletList");
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).textContent).toBe("after");
  });
});

describe("importDocx — images", () => {
  /**
   * Minimal real PNG bytes used end-to-end so the data-url survives the
   * exporter's ZIP write + importer's read + base64 encode.
   */
  const TINY_PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  /**
   * Round-trip a doc with one image of the given wrapMode through
   * exportDocx → importDocx and return the resulting image node.
   */
  async function roundTripImage(
    attrs: Record<string, unknown>,
  ): Promise<PmNode | null> {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(new Uint8Array(TINY_PNG_BYTES).buffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )) as typeof fetch;

    try {
      const editor = new ServerEditor();
      editor.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "image",
                attrs: {
                  src: "https://example.com/img.png",
                  width: 80,
                  height: 60,
                  ...attrs,
                },
              },
            ],
          },
        ],
      });
      const bytes = await exportDocxBytes(editor);
      const importer = new ServerEditor();
      const { doc } = await importDocx(importer, bytes);
      const para = doc.child(0);
      if (para.childCount === 0) return null;
      return para.child(0);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }

  it("inline image round-trips with width / height + data: src", async () => {
    const img = await roundTripImage({ wrapMode: "inline" });
    expect(img?.type.name).toBe("image");
    expect(img?.attrs["wrapMode"]).toBe("inline");
    expect(img?.attrs["width"]).toBe(80);
    expect(img?.attrs["height"]).toBe(60);
    const src = img?.attrs["src"];
    expect(typeof src).toBe("string");
    expect(src as string).toMatch(/^data:image\/png;base64,/);
  });

  it("square anchored image round-trips with wrapMode + xAlign", async () => {
    const img = await roundTripImage({ wrapMode: "square", xAlign: "right" });
    expect(img?.attrs["wrapMode"]).toBe("square");
    expect(img?.attrs["xAlign"]).toBe("right");
  });

  it("top-bottom wrap round-trips", async () => {
    const img = await roundTripImage({ wrapMode: "top-bottom" });
    expect(img?.attrs["wrapMode"]).toBe("top-bottom");
  });

  it("behind wrap round-trips with the right behindDoc state", async () => {
    const img = await roundTripImage({ wrapMode: "behind" });
    expect(img?.attrs["wrapMode"]).toBe("behind");
  });

  it("front wrap round-trips", async () => {
    const img = await roundTripImage({ wrapMode: "front" });
    expect(img?.attrs["wrapMode"]).toBe("front");
  });

  it("media: 'drop' returns no image and records a diagnostic", async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(new Uint8Array(TINY_PNG_BYTES).buffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )) as typeof fetch;
    try {
      const editor = new ServerEditor();
      editor.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "image",
                attrs: { src: "https://example.com/x.png", width: 50, height: 50, wrapMode: "inline" },
              },
            ],
          },
        ],
      });
      const bytes = await exportDocxBytes(editor);
      const importer = new ServerEditor();
      const { doc, diagnostics } = await importDocx(importer, bytes, { media: "drop" });
      const para = doc.child(0);
      expect(para.childCount).toBe(0); // image dropped
      expect(
        diagnostics.some((d) => d.code === "image-dropped" || d.code === "image-unresolved"),
      ).toBe(true);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

describe("importDocx — tables", () => {
  function tableEditor(content?: Record<string, unknown>): ServerEditor {
    const ed = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
    if (content) ed.setContent(content);
    return ed;
  }

  const cell = (text: string, attrs?: Record<string, unknown>) => ({
    type: "tableCell",
    ...(attrs ? { attrs } : {}),
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });

  const tableDoc = {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { layout: "fixed", grid: [120, 200] },
        content: [
          {
            type: "tableRow",
            attrs: { repeatHeader: true },
            content: [
              { type: "tableHeader", attrs: { background: "#f3f4f6" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }] },
              { type: "tableHeader", attrs: { background: "#f3f4f6" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }] },
            ],
          },
          { type: "tableRow", content: [cell("Ada"), cell("Engineer")] },
          { type: "tableRow", content: [cell("Grace"), cell("Admiral")] },
        ],
      },
    ],
  };

  it("round-trips a table: rows, cells, and cell text survive", async () => {
    const editor = tableEditor(tableDoc);
    const bytes = await exportDocxBytes(editor);
    const importer = tableEditor();
    const { doc, diagnostics } = await importDocx(importer, bytes);

    expect(diagnostics.filter((d) => d.level === "error")).toEqual([]);
    const table = doc.child(0);
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(3); // 3 rows
    const firstRow = table.child(0);
    expect(firstRow.childCount).toBe(2); // 2 cells
    expect(firstRow.child(0).textContent).toBe("Name");
    expect(table.child(1).child(0).textContent).toBe("Ada");
    expect(table.child(2).child(1).textContent).toBe("Admiral");
  });

  it("recovers the column grid widths", async () => {
    const editor = tableEditor(tableDoc);
    const bytes = await exportDocxBytes(editor);
    const importer = tableEditor();
    const { doc } = await importDocx(importer, bytes);
    expect(doc.child(0).attrs["grid"]).toEqual([120, 200]);
  });

  it("recovers the header row as repeatHeader + tableHeader cells with background", async () => {
    const editor = tableEditor(tableDoc);
    const bytes = await exportDocxBytes(editor);
    const importer = tableEditor();
    const { doc } = await importDocx(importer, bytes);

    const headerRow = doc.child(0).child(0);
    expect(headerRow.attrs["repeatHeader"]).toBe(true);
    expect(headerRow.child(0).type.name).toBe("tableHeader");
    expect(headerRow.child(0).attrs["background"]).toBe("#f3f4f6");
  });

  it("emits the OOXML table elements on export", async () => {
    const editor = tableEditor(tableDoc);
    const bytes = await exportDocxBytes(editor);
    const { unzipSync, strFromU8 } = await import("fflate");
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:tblGrid>");
    expect(xml).toContain('<w:gridCol w:w="1800"/>'); // 120px * 15 twips
    expect(xml).toContain("<w:tblHeader/>");
    expect(xml).toContain('w:fill="F3F4F6"');
  });
});

describe("importDocx — unsupported policy", () => {
  // Build a real exported DOCX, then surgically swap its document.xml to
  // include an element the parser doesn't model (here: <w:sdt>, a content
  // control). The rest of the package (Content_Types, rels, styles,
  // numbering) stays valid so the only unusual thing is the body content.
  async function buildDocWithUnsupportedElement(): Promise<Uint8Array> {
    const editor = new ServerEditor({ content: "anchor" });
    const bytes = await exportDocxBytes(editor);
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const entries = unzipSync(bytes);
    const original = strFromU8(entries["word/document.xml"]!);
    const sdtXml =
      "<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>control</w:t></w:r></w:p></w:sdtContent></w:sdt>";
    const swapped = original.replace("<w:sectPr", sdtXml + "<w:sectPr");
    const rebuilt: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(entries)) {
      rebuilt[path] = path === "word/document.xml" ? strToU8(swapped) : data;
    }
    return zipSync(rebuilt);
  }

  it("emits a diagnostic for unsupported top-level blocks (default 'drop')", async () => {
    const bytes = await buildDocWithUnsupportedElement();
    const importer = new ServerEditor();
    const { diagnostics } = await importDocx(importer, bytes);
    const unsupported = diagnostics.find(
      (d) => d.code === "unsupported-docx-element" && d.nodeType === "w:sdt",
    );
    expect(unsupported).toBeDefined();
    expect(unsupported?.level).toBe("warning");
  });

  it("throws DocxImportError when policy is 'throw'", async () => {
    const bytes = await buildDocWithUnsupportedElement();
    const importer = new ServerEditor();
    await expect(
      importDocx(importer, bytes, { unsupported: "throw" }),
    ).rejects.toThrow(DocxImportError);
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
