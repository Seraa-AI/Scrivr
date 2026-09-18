/**
 * What an import says about the typography it could not honour.
 *
 * A .docx states the faces it was written in. The editor either has them or
 * does not, and that is knowable at import — before anything is measured and
 * long before a PDF is drawn at coordinates the answer produced.
 */

import { describe, it, expect } from "vitest";
import { DefaultFontProvider, ServerEditor } from "@scrivr/core";
import type { DocxDiagnostic, FontResource } from "@scrivr/core";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";

const resource = (family: string): FontResource => ({
  id: family,
  family,
  weight: 400,
  style: "normal",
  bytes: () => Promise.resolve(new ArrayBuffer(8)),
});

/** A .docx whose single run is set in `family`. */
async function docxSetIn(family: string): Promise<Uint8Array> {
  const editor = new ServerEditor();
  editor.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "text", marks: [{ type: "fontFamily", attrs: { family } }] }],
      },
    ],
  });
  return exportDocxBytes(editor);
}

const importer = (fonts?: DefaultFontProvider) =>
  new ServerEditor(fonts ? { fonts } : {});

const provider = (...families: string[]) =>
  new DefaultFontProvider({
    default: resource("App Sans"),
    resources: families.map(resource),
  });

const fontDiagnostics = (list: readonly DocxDiagnostic[]) =>
  list.filter((d) => d.code === "font-substituted");

describe("font reporting at import", () => {
  it("says nothing when the editor has the face", async () => {
    const bytes = await docxSetIn("Inter");
    const { diagnostics } = await importDocx(importer(provider("Inter")), bytes);
    expect(fontDiagnostics(diagnostics)).toEqual([]);
  });

  it("reports a face the editor does not have", async () => {
    const bytes = await docxSetIn("Aptos");
    const { diagnostics } = await importDocx(importer(provider("Inter")), bytes);
    const [reported] = fontDiagnostics(diagnostics);
    expect(reported?.message).toContain("Aptos");
    expect(reported?.message).toContain("App Sans");
  });

  it("stays quiet when no provider was supplied", async () => {
    // Without a provider there is nobody to ask, and inventing an answer here
    // would be the guess this lane exists to remove.
    const bytes = await docxSetIn("Aptos");
    const { diagnostics } = await importDocx(importer(), bytes);
    expect(fontDiagnostics(diagnostics)).toEqual([]);
  });

  it("reports each missing face once, not once per run", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: Array.from({ length: 5 }, () => ({
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "fontFamily", attrs: { family: "Aptos" } }] }],
      })),
    });
    const bytes = await exportDocxBytes(editor);
    const { diagnostics } = await importDocx(importer(provider()), bytes);
    expect(fontDiagnostics(diagnostics)).toHaveLength(1);
  });
});
