/**
 * Formatting a document states once, in a style, and never repeats on the runs
 * that use it.
 *
 * A reader that only looks at `<w:rPr>` loses all of it. In the agreement this
 * was built against, the document's own typeface — Aptos at 10.5pt — is
 * declared only in the `Normal` style; not one of its 596 runs repeats it.
 */

import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { readStyleSheet, layer } from "./styles";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import type { DocxMark } from "@scrivr/core";

const sheet = (body: string) =>
  readStyleSheet(`<?xml version="1.0"?><w:styles xmlns:w="w">${body}</w:styles>`);

const kinds = (marks: readonly DocxMark[]) =>
  Object.fromEntries(marks.map((m) => [m.kind, m.attrs?.["val"] ?? true]));

const NORMAL = `
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:rPr><w:rFonts w:ascii="Aptos"/><w:sz w:val="21"/></w:rPr>
  </w:style>`;

describe("resolving a style", () => {
  it("falls back to the document defaults when no style is named", () => {
    expect(kinds(sheet(NORMAL).runMarks(undefined))).toEqual({ rFonts: true, sz: "22" });
  });

  it("layers a style over the document defaults", () => {
    // `sz` is replaced, and `rFonts` too — both named by the style.
    expect(kinds(sheet(NORMAL).runMarks("Normal"))).toEqual({ rFonts: true, sz: "21" });
  });

  it("follows basedOn outward, with the nearer style winning", () => {
    const styles = sheet(`${NORMAL}
      <w:style w:type="paragraph" w:styleId="Footer">
        <w:basedOn w:val="Normal"/>
        <w:pPr><w:spacing w:after="0"/></w:pPr>
      </w:style>
      <w:style w:type="paragraph" w:styleId="Quote">
        <w:basedOn w:val="Footer"/>
        <w:rPr><w:i/></w:rPr>
      </w:style>`);

    // Footer states no run properties at all, so a run using it is Aptos 21 —
    // which is exactly how the page number in a real footer gets its face.
    expect(kinds(styles.runMarks("Footer"))).toEqual({ rFonts: true, sz: "21" });
    expect(kinds(styles.runMarks("Quote"))).toEqual({ rFonts: true, sz: "21", i: true });
  });

  it("answers for a style that does not exist", () => {
    expect(kinds(sheet(NORMAL).runMarks("Nonexistent"))).toEqual({ rFonts: true, sz: "22" });
  });

  it("does not hang on a basedOn cycle", () => {
    const styles = sheet(`
      <w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/><w:rPr><w:i/></w:rPr></w:style>`);
    expect(kinds(styles.runMarks("A"))).toEqual({ b: true, i: true });
  });

  it("hands back the style itself, for properties only its owner can read", () => {
    // A table style's conditional formatting means nothing to a generic
    // reader; the extension that owns the node reads it from here.
    const styles = sheet(`<w:style w:type="table" w:styleId="Grid">
      <w:tblStylePr w:type="band1Horz"/>
    </w:style>`);
    expect(styles.raw("Grid")).toBeDefined();
    expect(styles.raw("Absent")).toBeUndefined();
  });

  it("resolves to nothing when the document has no stylesheet", () => {
    expect(readStyleSheet(undefined).runMarks("Normal")).toEqual([]);
  });
});

describe("layering run properties", () => {
  it("replaces a property rather than accumulating it", () => {
    const under: DocxMark[] = [{ kind: "sz", attrs: { val: "21" } }, { kind: "rFonts", attrs: {} }];
    const over: DocxMark[] = [{ kind: "sz", attrs: { val: "16" } }];
    expect(kinds(layer(under, over))).toEqual({ sz: "16", rFonts: true });
  });
});

/**
 * A run can refuse what its style states.
 *
 * `<w:b w:val="false"/>` is Word's way of saying "not bold here" — it is not
 * the absence of an opinion. Once a style can supply bold, dropping the
 * cancellation at the parser makes the style win and the document imports
 * bolder than it is.
 */
describe("a run that cancels its style's formatting", () => {
  const STYLES = `<?xml version="1.0"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="paragraph" w:styleId="Strong">
        <w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr>
      </w:style>
    </w:styles>`;

  const body = (rPr: string) => `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p>
        <w:pPr><w:pStyle w:val="Strong"/></w:pPr>
        <w:r><w:rPr>${rPr}</w:rPr><w:t>text</w:t></w:r>
      </w:p></w:body>
    </w:document>`;

  async function marksOf(rPr: string): Promise<string[]> {
    const base = await exportDocxBytes(new ServerEditor({ content: "seed" }));
    const parts = unzipSync(base);
    parts["word/document.xml"] = strToU8(body(rPr));
    parts["word/styles.xml"] = strToU8(STYLES);
    const { doc } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), zipSync(parts));
    const text = doc.child(0).child(0);
    return text.marks.map((m) => m.type.name).sort();
  }

  it("inherits the style's formatting when the run says nothing", async () => {
    expect(await marksOf("")).toEqual(["bold", "italic", "underline"]);
  });

  it.each([
    ['<w:b w:val="false"/>', "bold"],
    ['<w:i w:val="false"/>', "italic"],
    ['<w:u w:val="none"/>', "underline"],
  ])("drops %s, which the style would otherwise supply", async (rPr, cancelled) => {
    expect(await marksOf(rPr)).not.toContain(cancelled);
  });
});
