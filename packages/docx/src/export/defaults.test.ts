import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { ServerEditor } from "@scrivr/core";
import { buildDocxPackage, buildDocumentRoot } from "./defaults";
import { zipDocxPackage } from "./package";
import { xml } from "./xml";
import { createDocxContext } from "./createContext";

function readZip(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = strFromU8(v);
  }
  return out;
}

describe("buildDocxPackage", () => {
  it("produces all required OPC parts for an empty body", () => {
    const { state } = createDocxContext({ editor: new ServerEditor() });
    const pkg = buildDocxPackage(buildDocumentRoot([]), state);
    const bytes = zipDocxPackage(pkg);
    const files = readZip(bytes);

    const required = [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
      "word/numbering.xml",
      "word/settings.xml",
    ];
    for (const path of required) {
      expect(files[path], `missing part ${path}`).toBeTruthy();
    }
  });

  it("wraps body content in w:document/w:body and appends sectPr", () => {
    const { state } = createDocxContext({ editor: new ServerEditor() });
    const body = [xml("w:p", undefined, [xml("w:r", undefined, [xml("w:t", undefined, ["hi"])])])];
    const pkg = buildDocxPackage(buildDocumentRoot(body), state);
    const files = readZip(zipDocxPackage(pkg));

    const doc = files["word/document.xml"]!;
    expect(doc).toContain("<w:body>");
    expect(doc).toContain("<w:t>hi</w:t>");
    expect(doc).toContain("<w:sectPr>");
    expect(doc).toContain('<w:pgSz w:h="15840" w:w="12240"/>');
  });

  it("registers content-type overrides for the core OOXML parts", () => {
    const { state } = createDocxContext({ editor: new ServerEditor() });
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const ct = files["[Content_Types].xml"]!;
    expect(ct).toContain('PartName="/word/document.xml"');
    expect(ct).toContain('PartName="/word/styles.xml"');
    expect(ct).toContain('PartName="/word/numbering.xml"');
    expect(ct).toContain('PartName="/word/settings.xml"');
  });

  it("emits the named internal document rels (rIdStyles/Numbering/Settings)", () => {
    const { state } = createDocxContext({ editor: new ServerEditor() });
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const rels = files["word/_rels/document.xml.rels"]!;
    expect(rels).toContain('Id="rIdStyles"');
    expect(rels).toContain('Id="rIdNumbering"');
    expect(rels).toContain('Id="rIdSettings"');
  });

  it("appends user-registered styles to styles.xml", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    const id = ctx.styles.paragraph.getOrCreate("Heading 1", { bold: true, size: 18 });
    expect(id).toBe("Heading1");
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const styles = files["word/styles.xml"]!;
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('<w:name w:val="Heading 1"/>');
    expect(styles).toContain("<w:b/>");
    expect(styles).toContain('<w:sz w:val="27"/>'); // 18 × 1.5
  });

  it("keeps generated style IDs unique when sanitized names collide", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    const first = ctx.styles.paragraph.getOrCreate("A B", { bold: true });
    const second = ctx.styles.character.getOrCreate("AB", { italic: true });

    expect(first).toBe("AB");
    expect(second).toBe("AB2");

    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const styles = files["word/styles.xml"]!;
    expect(styles).toContain('w:styleId="AB"');
    expect(styles).toContain('w:styleId="AB2"');
  });

  it("each numbering level emits w:start=1 + w:ind so Word indents lists and starts ordered at 1", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    ctx.numbering.getOrCreate({
      type: "ordered",
      levels: [
        { level: 0, format: "decimal", text: "%1." },
        { level: 1, format: "decimal", text: "%2." },
      ],
    });
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const numbering = files["word/numbering.xml"]!;
    // Two levels each carry their own w:start=1 — ordered lists begin at 1, not 0.
    expect(numbering.match(/<w:start w:val="1"\/>/g)?.length).toBe(2);
    // Level 0: 720 twips left, level 1: 1440 twips left, both with 360 hanging.
    expect(numbering).toContain('<w:ind w:hanging="360" w:left="720"/>');
    expect(numbering).toContain('<w:ind w:hanging="360" w:left="1440"/>');
  });

  it("emits abstractNum + num pairs for registered numbering defs", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    ctx.numbering.getOrCreate({
      type: "bullet",
      levels: [{ level: 0, format: "bullet", text: "•" }],
    });
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const numbering = files["word/numbering.xml"]!;
    expect(numbering).toContain('<w:abstractNum w:abstractNumId="1">');
    expect(numbering).toContain('<w:num w:numId="1">');
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
  });

  it("dedupes identical numbering configs through getOrCreate", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    const config = {
      type: "bullet" as const,
      levels: [{ level: 0, format: "bullet" as const, text: "•" }],
    };
    const first = ctx.numbering.getOrCreate(config);
    const second = ctx.numbering.getOrCreate(config);

    expect(second.numId).toBe(first.numId);

    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const numbering = files["word/numbering.xml"]!;
    expect(numbering.match(/<w:abstractNum /g)?.length).toBe(1);
    expect(numbering.match(/<w:num /g)?.length).toBe(1);
  });

  it("registers media + adds Default content-type entry per unique extension", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    const filename = ctx.media.add({
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
      ext: "png",
    });
    expect(filename).toBe("image1.png");
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    expect(files["word/media/image1.png"]).toBeDefined();
    const ct = files["[Content_Types].xml"]!;
    expect(ct).toContain('Extension="png"');
    expect(ct).toContain('ContentType="image/png"');
  });

  it("emits user-registered rels with their Type + TargetMode", () => {
    const { ctx, state } = createDocxContext({ editor: new ServerEditor() });
    ctx.rels.addImage("image1.png");
    ctx.rels.addHyperlink("https://example.com");
    const files = readZip(zipDocxPackage(buildDocxPackage(buildDocumentRoot([]), state)));
    const rels = files["word/_rels/document.xml.rels"]!;
    expect(rels).toContain('Target="media/image1.png"');
    expect(rels).toContain('Target="https://example.com"');
    expect(rels).toContain('TargetMode="External"');
  });
});
