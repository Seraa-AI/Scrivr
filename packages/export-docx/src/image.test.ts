/**
 * Image DOCX export — contract test.
 *
 * The image extension lives in @scrivr/core and contributes its DOCX
 * handlers via `addExports().docx` using locally-declared types (no
 * runtime import of @scrivr/export-docx, by design — see Image.docx.ts).
 * This test is what guarantees the local types and the real DocxContext
 * shape stay structurally compatible: it drives a real ServerEditor +
 * StarterKit through `exportDocx` and asserts the produced bytes contain
 * a valid OOXML drawing for each wrap mode.
 *
 * Scrivr's ingestion gate (sanitizeDocUrls + safeUrl) rejects `data:` URLs
 * for image srcs, so the test fixtures use `https://` URLs with a mocked
 * `fetch` returning a tiny 1×1 PNG.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ServerEditor } from "@scrivr/core";
import { exportDocx } from "./export";

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

const PNG_URL = "https://example.com/x.png";
const FAIL_URL = "https://example.com/missing.png";

function mockFetch(_input: unknown): Promise<Response> {
  const url = String(_input);
  if (url === FAIL_URL) {
    return Promise.resolve(new Response("", { status: 404 }));
  }
  // Return a fresh ArrayBuffer copy each call — Response consumes the body.
  const copy = new Uint8Array(TINY_PNG_BYTES);
  return Promise.resolve(
    new Response(copy.buffer, {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function readText(entries: Record<string, Uint8Array>, path: string): string {
  const entry = entries[path];
  if (!entry) throw new Error(`missing OPC part: ${path}`);
  return strFromU8(entry);
}

function setImageDoc(
  editor: ServerEditor,
  attrs: Record<string, unknown>,
  src: string = PNG_URL,
): void {
  editor.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "image", attrs: { src, width: 100, height: 50, ...attrs } },
        ],
      },
    ],
  });
}

describe("image DOCX export", () => {
  it("emits a w:drawing for an inline image and registers media + rel", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "inline" });

    const { bytes, diagnostics } = await exportDocx(editor);
    const files = readZip(bytes);

    expect(diagnostics.filter((d) => d.code !== "unsupported-mark")).toEqual([]);
    expect(files["word/media/image1.png"]).toBeDefined();

    const documentXml = readText(files, "word/document.xml");
    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain("<wp:inline");
    // 100 px × 9525 = 952500 EMU; 50 px × 9525 = 476250 EMU.
    expect(documentXml).toContain('cx="952500"');
    expect(documentXml).toContain('cy="476250"');
    expect(documentXml).toContain('r:embed="rId1"');

    const relsXml = readText(files, "word/_rels/document.xml.rels");
    expect(relsXml).toContain('Target="media/image1.png"');

    const contentTypes = readText(files, "[Content_Types].xml");
    expect(contentTypes).toContain('Extension="png"');
  });

  it("emits wp:anchor + wp:wrapSquare for square wrap", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "square", xAlign: "center" });

    const { bytes } = await exportDocx(editor);
    const documentXml = readText(readZip(bytes), "word/document.xml");

    expect(documentXml).toContain("<wp:anchor");
    expect(documentXml).toContain('<wp:wrapSquare wrapText="bothSides"/>');
    expect(documentXml).toContain("<wp:align>center</wp:align>");
    expect(documentXml).toContain('behindDoc="0"');
  });

  it("emits wp:wrapTopAndBottom for top-bottom wrap", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "top-bottom" });

    const { bytes } = await exportDocx(editor);
    const documentXml = readText(readZip(bytes), "word/document.xml");

    expect(documentXml).toContain("<wp:anchor");
    expect(documentXml).toContain("<wp:wrapTopAndBottom/>");
  });

  it("emits behindDoc=1 + wp:wrapNone for behind", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "behind" });

    const { bytes } = await exportDocx(editor);
    const documentXml = readText(readZip(bytes), "word/document.xml");

    expect(documentXml).toContain('behindDoc="1"');
    expect(documentXml).toContain("<wp:wrapNone/>");
  });

  it("emits behindDoc=0 + wp:wrapNone for front", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "front" });

    const { bytes } = await exportDocx(editor);
    const documentXml = readText(readZip(bytes), "word/document.xml");

    expect(documentXml).toContain('behindDoc="0"');
    expect(documentXml).toContain("<wp:wrapNone/>");
  });

  it("uses a literal x via wp:posOffset when set on the node", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, { wrapMode: "square", xAlign: "custom", x: 200 });

    const { bytes } = await exportDocx(editor);
    const documentXml = readText(readZip(bytes), "word/document.xml");

    // 200 px × 9525 = 1905000 EMU.
    expect(documentXml).toContain("<wp:posOffset>1905000</wp:posOffset>");
    expect(documentXml).not.toContain("<wp:align>");
  });

  it("dedupes identical srcs — only one media part + rel per unique src", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: PNG_URL, width: 50, height: 50 } },
            { type: "image", attrs: { src: PNG_URL, width: 80, height: 80 } },
          ],
        },
      ],
    });

    const { bytes } = await exportDocx(editor);
    const files = readZip(bytes);

    expect(files["word/media/image1.png"]).toBeDefined();
    expect(files["word/media/image2.png"]).toBeUndefined();

    const relsXml = readText(files, "word/_rels/document.xml.rels");
    expect((relsXml.match(/Target="media\/image1\.png"/g) ?? []).length).toBe(1);

    const documentXml = readText(files, "word/document.xml");
    expect((documentXml.match(/r:embed="rId1"/g) ?? []).length).toBe(2);
  });

  it("records a fetch-failed diagnostic when an http URL is unreachable", async () => {
    const editor = new ServerEditor();
    setImageDoc(editor, {}, FAIL_URL);

    const { diagnostics } = await exportDocx(editor);
    expect(
      diagnostics.some(
        (d) => d.code === "image-fetch-failed" && d.nodeType === "image",
      ),
    ).toBe(true);
  });
});
