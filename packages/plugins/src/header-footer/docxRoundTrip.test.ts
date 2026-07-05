import { describe, it, expect } from "vitest";
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

  it("leaves a plain document with no headerFooter attr", async () => {
    const back = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    const out = new ServerEditor({ extensions: [StarterKit, HeaderFooter] });
    out.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] });
    const { bytes } = await exportDocx(out);
    const { doc } = await importDocx(back, bytes);
    expect(getHeaderFooterPolicy(doc)).toBeNull();
  });
});
