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

/**
 * Build a .docx whose single run is wrapped in a `<w:hyperlink>` carrying
 * `attrs`, with `rels` added to the document part. Hand-authored because our
 * own exporter only ever emits the `r:id` form, and Word emits more.
 */
async function docxWithHyperlink(
  attrs: string,
  rels: Array<[string, string]>,
): Promise<Uint8Array> {
  const editor = new ServerEditor();
  editor.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "click" }] }],
  });
  const { unzipSync, strFromU8, strToU8, zipSync } = await import("fflate");
  const zip = unzipSync(await exportDocxBytes(editor));

  const relsPath = "word/_rels/document.xml.rels";
  const added = rels
    .map(
      ([id, target]) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`,
    )
    .join("");
  zip[relsPath] = strToU8(
    strFromU8(zip[relsPath]!).replace("</Relationships>", `${added}</Relationships>`),
  );

  const docPath = "word/document.xml";
  zip[docPath] = strToU8(
    strFromU8(zip[docPath]!)
      .replace(/<w:r>/, `<w:hyperlink ${attrs}><w:r>`)
      .replace(/<\/w:r>/, "</w:r></w:hyperlink>"),
  );
  return zipSync(zip);
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

  it("resolves a bookmark link to a fragment", async () => {
    const bytes = await docxWithHyperlink('w:anchor="section-2"', []);
    const { doc } = await importDocx(new ServerEditor(), bytes);
    const link = doc.child(0).child(0).marks.find((m) => m.type.name === "link");
    expect(link?.attrs["href"]).toBe("#section-2");
  });

  it("joins a target and an anchor the way Word resolves them", async () => {
    const bytes = await docxWithHyperlink('r:id="rX" w:anchor="s2"', [
      ["rX", "https://example.com/doc"],
    ]);
    const { doc } = await importDocx(new ServerEditor(), bytes);
    const link = doc.child(0).child(0).marks.find((m) => m.type.name === "link");
    expect(link?.attrs["href"]).toBe("https://example.com/doc#s2");
  });

  it("falls through to the anchor when the relationship does not resolve", async () => {
    const bytes = await docxWithHyperlink('r:id="rMissing" w:anchor="s2"', []);
    const { doc } = await importDocx(new ServerEditor(), bytes);
    const link = doc.child(0).child(0).marks.find((m) => m.type.name === "link");
    expect(link?.attrs["href"]).toBe("#s2");
  });

  it("says so when it drops a link it cannot resolve", async () => {
    const bytes = await docxWithHyperlink('r:id="rMissing"', []);
    const { doc, diagnostics } = await importDocx(new ServerEditor(), bytes);
    expect(doc.child(0).child(0).marks.map((m) => m.type.name)).not.toContain("link");
    // A lossy import is acceptable; an invisible one is not.
    expect(diagnostics.filter((d) => d.markType === "hyperlink")).toHaveLength(1);
  });

  it("no longer rejects a linked document under unsupported: throw", async () => {
    // Before the Link extension claimed the mark, every hyperlink produced an
    // `unsupported-mark` diagnostic, and that code is in the fatal set — so a
    // `throw` caller could not import any document containing a link at all.
    const bytes = await docxWithHyperlink('r:id="rX"', [["rX", "https://example.com"]]);
    await expect(
      importDocx(new ServerEditor(), bytes, { unsupported: "throw" }),
    ).resolves.toBeDefined();
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
