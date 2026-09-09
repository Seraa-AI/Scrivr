/**
 * A .docx says where its links point in two places: the run wrapper names a
 * relationship, and the part's rels resolve it to a target. Both halves have
 * to be read, or a link arrives as ordinary text.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";

/** Round-trip one linked run and return the marks it came back with. */
async function roundTrip(href: string): Promise<{ marks: string[]; href?: unknown; text: string }> {
  const editor = new ServerEditor();
  editor.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href } }] }],
      },
    ],
  });
  const bytes = await exportDocxBytes(editor);
  const { doc } = await importDocx(new ServerEditor(), bytes);
  const run: PmNode = doc.child(0).child(0);
  const link = run.marks.find((m) => m.type.name === "link");
  return {
    marks: run.marks.map((m) => m.type.name),
    ...(link ? { href: link.attrs["href"] } : {}),
    text: run.textContent,
  };
}

describe("hyperlink import", () => {
  it("round-trips a link through DOCX", async () => {
    const r = await roundTrip("https://example.com/x");
    expect(r.text).toBe("click");
    expect(r.marks).toContain("link");
    expect(r.href).toBe("https://example.com/x");
  });

  it("keeps other marks on the linked run", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bold link",
              marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const { doc } = await importDocx(new ServerEditor(), bytes);
    const run = doc.child(0).child(0);
    expect(run.marks.map((m) => m.type.name).sort()).toEqual(["bold", "link"]);
  });

  it("no longer reports the hyperlink as unsupported", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
      ],
    });
    const bytes = await exportDocxBytes(editor);
    const { diagnostics } = await importDocx(new ServerEditor(), bytes);
    expect(diagnostics.filter((d) => d.markType === "hyperlink")).toEqual([]);
  });

  it("drops a hostile target rather than importing it", async () => {
    // A .docx is untrusted input; its rels are an ingestion path like any other.
    const editor = new ServerEditor();
    editor.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] });
    const clean = await exportDocxBytes(editor);
    // Rewrite the exported rels to carry a scheme `safeUrl` rejects.
    const { unzipSync, strFromU8, strToU8, zipSync } = await import("fflate");
    const zip = unzipSync(clean);
    const relsPath = "word/_rels/document.xml.rels";
    zip[relsPath] = strToU8(
      strFromU8(zip[relsPath]!).replace(
        "</Relationships>",
        '<Relationship Id="rHostile" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>',
      ),
    );
    const docPath = "word/document.xml";
    zip[docPath] = strToU8(
      strFromU8(zip[docPath]!).replace(
        /<w:r>/,
        '<w:hyperlink r:id="rHostile"><w:r>',
      ).replace(/<\/w:r>/, "</w:r></w:hyperlink>"),
    );
    const { doc } = await importDocx(new ServerEditor(), zipSync(zip));
    const marks = doc.child(0).child(0).marks.map((m) => m.type.name);
    expect(marks).not.toContain("link");
  });
});
