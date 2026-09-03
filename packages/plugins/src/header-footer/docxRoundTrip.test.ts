import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { exportDocx, importDocx } from "@scrivr/docx";
import { HeaderFooter } from "./HeaderFooter";
import { getHeaderFooterPolicy } from "./getPolicy";
import type { HeaderFooterContent, HeaderFooterPolicy } from "./types";

/**
 * Round-trip: a doc with headers/footers exports to DOCX, then imports back
 * with its chrome intact — text, page-number tokens, images, and
 * different-first-page all reconstruct onto `doc.attrs.headerFooter`.
 */

// 1×1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function para(text: string): HeaderFooterContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function roundTrip(policy: HeaderFooterPolicy): Promise<HeaderFooterPolicy | null> {
  const out = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
  out.setContent({
    type: "doc",
    attrs: { headerFooter: policy },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
  });
  const { bytes } = await exportDocx(out);

  const back = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
  const { doc } = await importDocx(back, bytes);
  return getHeaderFooterPolicy(doc);
}

describe("header/footer DOCX round-trip", () => {
  it("reconstructs header text, footer page number, and different-first-page", async () => {
    const footer: HeaderFooterContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "pageNumber" }] }],
    };
    const policy = await roundTrip({
      enabled: true,
      differentFirstPage: true,
      differentOddEven: false,
      defaultHeader: { content: para("My Header") },
      defaultFooter: { content: footer },
      firstPageHeader: { content: para("First Header") },
    });

    expect(policy).not.toBeNull();
    expect(policy!.enabled).toBe(true);
    expect(policy!.differentFirstPage).toBe(true);

    // Header text survives.
    expect(JSON.stringify(policy!.defaultHeader!.content)).toContain("My Header");
    // First-page slot survives.
    expect(JSON.stringify(policy!.firstPageHeader!.content)).toContain("First Header");
    // The page-number token comes back as a live node, not static text.
    expect(JSON.stringify(policy!.defaultFooter!.content)).toContain("pageNumber");
  });

  it("reconstructs an image inside a header", async () => {
    const header: HeaderFooterContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: PNG } }] }],
    };
    const policy = await roundTrip({
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: { content: header },
    });

    expect(policy).not.toBeNull();
    const json = JSON.stringify(policy!.defaultHeader!.content);
    expect(json).toContain("\"image\"");
    // The image src materializes back to a data URL (part-scoped rels resolved).
    expect(json).toContain("data:image/png");
  });

  it("reconstructs odd/even chrome via <w:evenAndOddHeaders>", async () => {
    const policy = await roundTrip({
      enabled: true,
      differentFirstPage: false,
      differentOddEven: true,
      defaultHeader: { content: para("Odd Header") },
      evenPageHeader: { content: para("Even Header") },
    });

    expect(policy).not.toBeNull();
    expect(policy!.differentOddEven).toBe(true);
    expect(JSON.stringify(policy!.defaultHeader!.content)).toContain("Odd Header");
    expect(JSON.stringify(policy!.evenPageHeader!.content)).toContain("Even Header");
  });

  it("gates first-page chrome on <w:titlePg>, not the reference", async () => {
    // Export a doc with a first-page header (writes both the reference AND
    // <w:titlePg/>), then strip <w:titlePg/> from the document. A first
    // reference without titlePg is inactive → differentFirstPage must be false.
    const out = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    out.setContent({
      type: "doc",
      attrs: {
        headerFooter: {
          enabled: true,
          differentFirstPage: true,
          differentOddEven: false,
          defaultHeader: { content: para("Default Header") },
          firstPageHeader: { content: para("First Header") },
        },
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
    });
    const { bytes } = await exportDocx(out);

    const entries = unzipSync(bytes);
    const doc = strFromU8(entries["word/document.xml"]!);
    expect(doc).toContain("<w:titlePg");
    entries["word/document.xml"] = strToU8(doc.replace(/<w:titlePg\s*\/>/, ""));
    const stripped = zipSync(entries);

    const back = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    const { doc: imported } = await importDocx(back, stripped);
    const policy = getHeaderFooterPolicy(imported);

    expect(policy).not.toBeNull();
    expect(policy!.differentFirstPage).toBe(false);
  });

  it("reports unsupported fields instead of silently dropping them", async () => {
    const out = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    out.setContent({
      type: "doc",
      attrs: {
        headerFooter: {
          enabled: true,
          differentFirstPage: false,
          differentOddEven: false,
          defaultHeader: { content: para("Header") },
        },
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
    });
    const { bytes } = await exportDocx(out);
    const entries = unzipSync(bytes);
    const headerPath = Object.keys(entries).find((p) => /^word\/header\d+\.xml$/.test(p))!;
    const header = strFromU8(entries[headerPath]!);
    entries[headerPath] = strToU8(
      header.replace("</w:p>", '<w:fldSimple w:instr=" STYLEREF 1 "><w:r><w:t>Title</w:t></w:r></w:fldSimple></w:p>'),
    );

    const back = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    const result = await importDocx(back, zipSync(entries));
    expect(result.diagnostics.some((d) => d.code === "unsupported-docx-field")).toBe(true);
  });

  it("leaves a plain document with no headerFooter attr", async () => {
    const back = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    const out = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    out.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] });
    const { bytes } = await exportDocx(out);
    const { doc } = await importDocx(back, bytes);
    expect(getHeaderFooterPolicy(doc)).toBeNull();
  });
});
