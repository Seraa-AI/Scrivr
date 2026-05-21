/**
 * End-to-end pipeline tests — drives a real `ServerEditor` + `StarterKit`
 * through `exportDocx` and verifies the produced bytes are a valid OPC
 * package. The base PR ships no built-in handlers, so a doc with content
 * exits via the "drop" policy and surfaces diagnostics — those warnings
 * are how a consumer sees that handler registration is still pending.
 */

import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ServerEditor, Extension, StarterKit } from "@scrivr/core";
import { exportDocx, exportDocxBytes } from "./export";
import { DocxExportError } from "./error";
import { xml } from "./xml";
import type { DocxHandlers } from "./handlers";

// Minimal extension used to exercise the unsupported-node policy — adds a
// node type that no extension contributes a docx handler for.
const UnhandledNode = Extension.create({
  name: "unhandledNode",
  addNodes() {
    return {
      unhandledNode: {
        group: "block",
        content: "inline*",
        toDOM: () => ["div"],
        parseDOM: [{ tag: "div.unhandled" }],
      },
    };
  },
});

function editorWithUnhandled(): ServerEditor {
  const editor = new ServerEditor({ extensions: [StarterKit, UnhandledNode] });
  const doc = editor.schema.node("doc", null, [
    editor.schema.node("unhandledNode", null, [editor.schema.text("x")]),
  ]);
  editor.setContent(doc.toJSON());
  return editor;
}

function readZip(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = strFromU8(v);
  }
  return out;
}

describe("exportDocx", () => {
  it("returns { bytes, diagnostics } on success", async () => {
    const editor = new ServerEditor();
    const result = await exportDocx(editor);

    expect(result).toHaveProperty("bytes");
    expect(result).toHaveProperty("diagnostics");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("produces a valid OPC package with all required parts", async () => {
    const editor = new ServerEditor();
    const result = await exportDocx(editor);
    const files = readZip(result.bytes);

    for (const path of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
      "word/numbering.xml",
      "word/settings.xml",
    ]) {
      expect(files[path], `missing OPC part: ${path}`).toBeTruthy();
    }
  });

  it("applies default handlers — plain text exports without warnings", async () => {
    const editor = new ServerEditor({ content: "hello **world**" });
    const { bytes, diagnostics } = await exportDocx(editor);
    const files = readZip(bytes);
    const documentXml = files["word/document.xml"]!;

    expect(diagnostics).toEqual([]);
    expect(documentXml).toContain('<w:t xml:space="preserve">hello </w:t>');
    expect(documentXml).toContain("<w:t>world</w:t>");
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toMatch(/<w:p>/);
  });

  it("per-call overrides supersede defaults", async () => {
    const editor = new ServerEditor({ content: "hi" });
    const overrides: DocxHandlers = {
      nodes: {
        paragraph: (_n, children) =>
          xml("w:p", undefined, [
            xml("w:pPr", undefined, [xml("w:pStyle", { "w:val": "Custom" })]),
            ...children,
          ]),
      },
    };
    const { bytes } = await exportDocx(editor, { overrides });
    const documentXml = readZip(bytes)["word/document.xml"]!;
    expect(documentXml).toContain('<w:pStyle w:val="Custom"/>');
  });

  it("emits unsupported-node warnings for node types no extension contributes", async () => {
    const editor = editorWithUnhandled();
    const { diagnostics } = await exportDocx(editor);
    expect(
      diagnostics.some(
        (d) => d.code === "unsupported-node" && d.nodeType === "unhandledNode",
      ),
    ).toBe(true);
  });

  it("upgrades unsupported nodes to a DocxExportError when policy is 'throw'", async () => {
    const editor = editorWithUnhandled();
    await expect(exportDocx(editor, { unsupported: "throw" })).rejects.toThrow(
      DocxExportError,
    );
  });

  it("preserves diagnostics on a thrown DocxExportError", async () => {
    const editor = editorWithUnhandled();
    try {
      await exportDocx(editor, { unsupported: "throw" });
      throw new Error("expected DocxExportError");
    } catch (err) {
      expect(err).toBeInstanceOf(DocxExportError);
      if (!(err instanceof DocxExportError)) throw err;
      expect(err.diagnostics.length).toBeGreaterThan(0);
      expect(err.diagnostics.some((d) => d.level === "error")).toBe(true);
    }
  });

  it("exports bullet lists with numPr referencing a bullet numbering def", async () => {
    const editor = new ServerEditor({ content: "* first\n* second" });
    const { bytes, diagnostics } = await exportDocx(editor);
    const files = readZip(bytes);
    const documentXml = files["word/document.xml"]!;
    const numberingXml = files["word/numbering.xml"]!;

    expect(diagnostics.filter((d) => d.code === "unsupported-node")).toEqual([]);
    // Two listItems → two <w:p> with numPr.
    expect(documentXml.match(/<w:numPr>/g)?.length).toBe(2);
    expect(documentXml).toContain('<w:ilvl w:val="0"/>');
    expect(documentXml).toContain('<w:t>first</w:t>');
    expect(documentXml).toContain('<w:t>second</w:t>');
    // numbering.xml has the bullet def.
    expect(numberingXml).toContain('<w:numFmt w:val="bullet"/>');
  });

  it("exports ordered lists with a decimal numbering def", async () => {
    const editor = new ServerEditor({ content: "1. one\n2. two" });
    const { bytes } = await exportDocx(editor);
    const files = readZip(bytes);
    const documentXml = files["word/document.xml"]!;
    const numberingXml = files["word/numbering.xml"]!;

    expect(documentXml.match(/<w:numPr>/g)?.length).toBe(2);
    expect(numberingXml).toContain('<w:numFmt w:val="decimal"/>');
  });

  it("always emits a non-empty w:body (Word rejects empty bodies)", async () => {
    // Even with a fully unhandled doc, the body must contain at least
    // one paragraph or Word refuses to open the file.
    const editor = new ServerEditor();
    const doc = editor.schema.node("doc", null, [
      editor.schema.node("paragraph"),
    ]);
    editor.setContent(doc.toJSON());

    const { bytes } = await exportDocx(editor);
    const documentXml = readZip(bytes)["word/document.xml"]!;
    expect(documentXml).toMatch(/<w:body>.*<w:p\/?>/s);
  });

  it("runs onBeforeExport, onBuildTreeComplete, and onFinalize hooks in order", async () => {
    const editor = new ServerEditor();
    const log: string[] = [];

    const overrides: DocxHandlers = {
      onBeforeExport: () => {
        log.push("before");
      },
      onBuildTreeComplete: () => {
        log.push("after-tree");
      },
      onFinalize: () => {
        log.push("finalize");
        return {
          parts: [
            { path: "[Content_Types].xml", data: "<types/>" },
            { path: "word/document.xml", data: "<doc/>" },
          ],
        };
      },
    };

    const { bytes } = await exportDocx(editor, { overrides });
    expect(log).toEqual(["before", "after-tree", "finalize"]);
    // onFinalize replaced the package — only the two parts the hook returned.
    const files = readZip(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "word/document.xml",
    ]);
  });
});

describe("exportDocxBytes (ergonomic helper)", () => {
  it("returns just the Uint8Array, dropping diagnostics", async () => {
    const editor = new ServerEditor();
    const bytes = await exportDocxBytes(editor);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe("exportDocx — determinism", () => {
  it("produces identical bytes for the same input across runs", async () => {
    const editor = new ServerEditor({ content: "hello" });
    const overrides: DocxHandlers = {
      nodes: {
        paragraph: (_n, children) => xml("w:p", undefined, children),
      },
    };
    const a = await exportDocxBytes(editor, { overrides });
    const b = await exportDocxBytes(editor, { overrides });
    expect(a).toEqual(b);
  });
});
