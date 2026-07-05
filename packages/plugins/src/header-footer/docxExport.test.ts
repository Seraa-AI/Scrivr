import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { exportDocx } from "@scrivr/docx";
import { HeaderFooter } from "./HeaderFooter";
import type { HeaderFooterContent, HeaderFooterPolicy } from "./types";

/**
 * End-to-end: the HeaderFooter extension contributes `addExports().docx`, so a
 * doc with a headerFooter policy produces real `word/header1.xml` / `footer1.xml`
 * parts, sectPr references, content types, and rels.
 */

function para(text: string): HeaderFooterContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function exportWith(policy: HeaderFooterPolicy): Promise<Record<string, string>> {
  const editor = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
  editor.setContent({
    type: "doc",
    attrs: { headerFooter: policy },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
  });
  const { bytes } = await exportDocx(editor);
  const entries = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) out[k] = strFromU8(v);
  return out;
}

const basePolicy: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
};

describe("header/footer DOCX export", () => {
  it("emits header/footer parts, sectPr references, content types, and rels", async () => {
    const zip = await exportWith({
      ...basePolicy,
      defaultHeader: { content: para("My Header") },
      defaultFooter: { content: para("My Footer") },
    });

    // Parts exist with the walked content.
    expect(zip["word/header1.xml"]).toContain("<w:hdr");
    expect(zip["word/header1.xml"]).toContain("My Header");
    expect(zip["word/footer1.xml"]).toContain("<w:ftr");
    expect(zip["word/footer1.xml"]).toContain("My Footer");

    // sectPr references the parts (attributes serialize alphabetically).
    const doc = zip["word/document.xml"]!;
    expect(doc).toContain("<w:headerReference");
    expect(doc).toContain("<w:footerReference");
    expect(doc).toContain('w:type="default"');

    // Content-type overrides + relationships.
    expect(zip["[Content_Types].xml"]).toContain("/word/header1.xml");
    expect(zip["[Content_Types].xml"]).toContain("wordprocessingml.header+xml");
    const rels = zip["word/_rels/document.xml.rels"]!;
    expect(rels).toContain("header1.xml");
    expect(rels).toContain("footer1.xml");
    expect(rels).toContain("relationships/header");
  });

  it("differentFirstPage adds a titlePg and first-page parts", async () => {
    const zip = await exportWith({
      ...basePolicy,
      differentFirstPage: true,
      defaultHeader: { content: para("Default H") },
      firstPageHeader: { content: para("First H") },
    });

    const doc = zip["word/document.xml"]!;
    expect(doc).toContain("<w:titlePg/>");
    expect(doc).toContain('w:type="first"');
    expect(zip["word/header2.xml"]).toContain("First H");
  });

  it("exports a page-number token as a Word field", async () => {
    const footerContent: HeaderFooterContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "pageNumber" }] }],
    };
    const zip = await exportWith({ ...basePolicy, defaultFooter: { content: footerContent } });
    expect(zip["word/footer1.xml"]).toContain('w:fldSimple w:instr=" PAGE "');
  });

  it("exports an image inside a header with part-scoped rels", async () => {
    // 1×1 transparent PNG.
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const headerContent: HeaderFooterContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", attrs: { src: PNG } }] },
      ],
    };
    const zip = await exportWith({ ...basePolicy, defaultHeader: { content: headerContent } });

    // Bytes land in the global media pool.
    expect(zip["word/media/image1.png"]).toBeDefined();

    // The header part references the image via a relationship id…
    const header = zip["word/header1.xml"]!;
    expect(header).toContain("<w:drawing");
    const embed = header.match(/r:embed="([^"]+)"/);
    expect(embed).not.toBeNull();

    // …resolved by the PART's own rels file, not the document's.
    const partRels = zip["word/_rels/header1.xml.rels"];
    expect(partRels).toBeDefined();
    expect(partRels!).toContain("media/image1.png");
    expect(partRels!).toContain(`Id="${embed![1]}"`);
    expect(partRels!).toContain("relationships/image");

    // The document rels must NOT carry the header's image relationship.
    expect(zip["word/_rels/document.xml.rels"]!).not.toContain("media/image1.png");
  });

  it("produces no header/footer parts when the policy is disabled", async () => {
    const zip = await exportWith({ ...basePolicy, enabled: false, defaultHeader: { content: para("X") } });
    expect(zip["word/header1.xml"]).toBeUndefined();
    expect(zip["word/document.xml"]).not.toContain("headerReference");
  });
});
