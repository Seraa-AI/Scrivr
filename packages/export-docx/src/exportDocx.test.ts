/**
 * End-to-end pipeline tests — drives a real `ServerEditor` + `StarterKit`
 * through `exportDocx` and verifies the produced bytes are a valid OPC
 * package. The base PR ships no built-in handlers, so a doc with content
 * exits via the "drop" policy and surfaces diagnostics — those warnings
 * are how a consumer sees that handler registration is still pending.
 */

import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ServerEditor } from "@scrivr/core";
import { exportDocx, exportDocxBytes } from "./export";
import { DocxExportError } from "./error";
import { xml } from "./xml";
import type { DocxHandlers } from "./handlers";

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

  it("walks the document and applies registered overrides", async () => {
    const editor = new ServerEditor({ content: "hello world" });
    const overrides: DocxHandlers = {
      nodes: {
        paragraph: (_n, children) => xml("w:p", undefined, children),
      },
    };
    const { bytes, diagnostics } = await exportDocx(editor, { overrides });
    const files = readZip(bytes);
    const documentXml = files["word/document.xml"]!;

    expect(documentXml).toContain("<w:t>hello world</w:t>");
    expect(diagnostics.filter((d) => d.code === "unsupported-node")).toEqual([]);
  });

  it("emits unsupported-node warnings when no paragraph handler is registered", async () => {
    const editor = new ServerEditor({ content: "hello" });
    const { diagnostics } = await exportDocx(editor);
    expect(
      diagnostics.some(
        (d) => d.code === "unsupported-node" && d.nodeType === "paragraph",
      ),
    ).toBe(true);
  });

  it("upgrades unsupported nodes to a DocxExportError when policy is 'throw'", async () => {
    const editor = new ServerEditor({ content: "hello" });
    await expect(exportDocx(editor, { unsupported: "throw" })).rejects.toThrow(
      DocxExportError,
    );
  });

  it("preserves diagnostics on a thrown DocxExportError", async () => {
    const editor = new ServerEditor({ content: "hello" });
    try {
      await exportDocx(editor, { unsupported: "throw" });
      throw new Error("expected DocxExportError");
    } catch (err) {
      expect(err).toBeInstanceOf(DocxExportError);
      const diags = (err as DocxExportError).diagnostics;
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some((d) => d.level === "error")).toBe(true);
    }
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
