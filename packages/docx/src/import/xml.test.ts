import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ServerEditor } from "@scrivr/core";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import { parseOoxml } from "./xml";

/** A one-paragraph file saying "before", with `document.xml` rewritten. */
async function docxWith(rewrite: (documentXml: string) => string) {
  const zip = unzipSync(await exportDocxBytes(new ServerEditor({ content: "before" })));
  zip["word/document.xml"] = strToU8(rewrite(strFromU8(zip["word/document.xml"]!)));
  return zipSync(zip);
}

describe("parseOoxml", () => {
  it("reads numeric character references, in text and in attributes", () => {
    const root = parseOoxml(`<w:t w:val="it&#8217;s">it&#8217;s &#x1F600; &amp;#65;</w:t>`);

    expect(root).toEqual({ name: "w:t", attrs: { "w:val": "it’s" }, children: ["it’s 😀 &#65;"] });
  });

  it.each(["constructor", "prototype", "__proto__"])("imports the document around a %s element and attribute", async (name) => {
    const bytes = await docxWith((xml) => xml.replace("</w:body>", `<${name} ${name}="1"/><w:p><w:r><w:t>after</w:t></w:r></w:p></w:body>`));
    const { doc, diagnostics } = await importDocx(new ServerEditor(), bytes);

    expect(doc.textContent).toBe("beforeafter");
    expect(diagnostics.map((d) => d.code)).toContain("unsupported-docx-element");
  });

  it("refuses XML that ends its root early and goes on", async () => {
    const bytes = await docxWith((xml) => xml.replace("</w:body>", "</w:body></w:document><w:p><w:r><w:t>lost</w:t></w:r></w:p>"));

    await expect(importDocx(new ServerEditor(), bytes)).rejects.toThrow("more than one root");
  });

  it("keeps the document's text out of the error for XML it cannot read", async () => {
    const bytes = await docxWith((xml) => xml.replace("</w:body>", `<w:p w:val="secret salary>`));
    const error: unknown = await importDocx(new ServerEditor(), bytes).catch((e: unknown) => e);

    expect(String(error)).toContain("DocxImportError");
    expect(String(error)).not.toContain("salary");
  });
});
