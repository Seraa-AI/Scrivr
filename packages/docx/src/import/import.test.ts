/**
 * Import smoke tests. Strategy: build a known doc, run it through
 * `exportDocx` to get real OOXML bytes, then feed those bytes to
 * `importDocx` and assert the structure round-trips. Avoids hand-crafting
 * brittle XML fixtures — the exporter is the canonical source.
 *
 * MVP scope here matches the parser's MVP: paragraphs + text only.
 * Marks, headings, lists, images each get focused tests when their
 * milestones land.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "@scrivr/core";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import { DocxImportError } from "./error";

describe("importDocx — MVP (paragraph + text)", () => {
  it("returns { doc, diagnostics }", async () => {
    const editor = new ServerEditor({ content: "hello" });
    const bytes = await exportDocxBytes(editor);
    const result = await importDocx(bytes);
    expect(result).toHaveProperty("doc");
    expect(result).toHaveProperty("diagnostics");
    expect(result.doc.type).toBe("doc");
    expect(Array.isArray(result.doc.content)).toBe(true);
  });

  it("recovers paragraph text from a one-paragraph doc", async () => {
    const editor = new ServerEditor({ content: "hello world" });
    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(bytes);

    expect(doc.content).toHaveLength(1);
    const para = doc.content[0]!;
    expect(para.type).toBe("paragraph");
    // Marks aren't transformed yet in MVP — text content alone should round-trip.
    const text = (para.content ?? [])
      .filter((n): n is { type: "text"; text: string } => n.type === "text")
      .map((n) => n.text)
      .join("");
    expect(text).toBe("hello world");
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
    const { doc } = await importDocx(bytes);

    const texts = doc.content.map((p) =>
      (p.content ?? [])
        .filter((n): n is { type: "text"; text: string } => n.type === "text")
        .map((n) => n.text)
        .join(""),
    );
    expect(texts).toEqual(["first", "second", "third"]);
  });

  it("preserves edge whitespace via xml:space=preserve on w:t", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "  leading and trailing  " },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(bytes);
    const text = (doc.content[0]?.content ?? [])
      .filter((n): n is { type: "text"; text: string } => n.type === "text")
      .map((n) => n.text)
      .join("");
    expect(text).toBe("  leading and trailing  ");
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
    const { doc } = await importDocx(bytes);
    const kinds = (doc.content[0]?.content ?? []).map((n) => n.type);
    expect(kinds).toEqual(["text", "hardBreak", "text"]);
  });

  it("emits at least one paragraph for an effectively empty doc", async () => {
    const editor = new ServerEditor();
    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(bytes);
    expect(doc.content.length).toBeGreaterThan(0);
    expect(doc.content[0]?.type).toBe("paragraph");
  });

  it("throws DocxImportError on malformed bytes", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    await expect(importDocx(garbage)).rejects.toThrow(DocxImportError);
  });

  it("throws DocxImportError when document.xml is missing", async () => {
    // A valid ZIP that's not a DOCX (no word/document.xml part).
    const { zipSync, strToU8 } = await import("fflate");
    const bytes = zipSync({
      "not-a-docx.txt": strToU8("hello"),
    });
    await expect(importDocx(bytes)).rejects.toThrow(/word\/document\.xml/);
  });
});
