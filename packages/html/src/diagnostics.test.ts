/**
 * An agent that wrote a style needs to hear when it did not land, or it will
 * keep writing it. What the schema's rules read is what landed; everything
 * else is reported, once per kind, with how often it occurred.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { importHtml, type HtmlImportDiagnostic } from "./index";

async function diagnosticsOf(html: string): Promise<HtmlImportDiagnostic[]> {
  const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
  return (await importHtml(editor, html)).diagnostics;
}

describe("importHtml diagnostics", () => {
  it("reports nothing for HTML the schema holds in full", async () => {
    expect(
      await diagnosticsOf(
        `<div><h1 style="text-align:center">T</h1>` +
          `<p style="margin-left:24px;text-indent:24px">` +
          `<span style="color:#c00;font-weight:bold;font-size:12px">x</span></p>` +
          `<table><tbody><tr><td>c</td></tr></tbody></table></div>`,
      ),
    ).toEqual([]);
  });

  it("reports a style no rule reads, once, with how many elements carried it", async () => {
    const diagnostics = await diagnosticsOf(
      `<p style="line-height:1.5">a</p><p style="line-height:2;margin-top:8px">b</p>`,
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "line-height", count: 2 }),
      expect.objectContaining({ code: "html-style-unsupported", property: "margin-top", count: 1 }),
    ]);
  });

  it("judges a style by the element carrying it — a block's indent is not a span's", async () => {
    const diagnostics = await diagnosticsOf(`<p><span style="margin-left:24px">a</span></p>`);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "margin-left", count: 1 }),
    ]);
  });

  it("reports an element no rule reads, keeping its text", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    const { doc, diagnostics } = await importHtml(editor, `<p>E = mc<sup>2</sup></p>`);
    expect(doc.textContent).toBe("E = mc2");
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-element-unknown", tag: "sup", count: 1 }),
    ]);
  });

  it("reports an element whose content is dropped", async () => {
    const diagnostics = await diagnosticsOf(`<p>a</p><script>alert(1)</script><noscript>b</noscript>`);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-element-ignored", tag: "script", count: 1 }),
      expect.objectContaining({ code: "html-element-ignored", tag: "noscript", count: 1 }),
    ]);
  });

  it("reports an element its rule turned away, such as an unsafe link", async () => {
    const diagnostics = await diagnosticsOf(`<p><a href="javascript:alert(1)">x</a></p>`);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-element-rejected", tag: "a", count: 1 }),
    ]);
  });

  it("a shorthand is applied when every longhand it sets was read", async () => {
    expect(
      await diagnosticsOf(`<p><span style="background: yellow">h</span> <span style="font: bold 20px Georgia">f</span></p>`),
    ).toEqual([]);
  });

  it("a shorthand is reported when any longhand it sets was dropped", async () => {
    const diagnostics = await diagnosticsOf(
      `<p style="margin: 24px 0">m</p><p><span style="background: url(a.png) no-repeat">b</span>` +
        `<span style="font: italic 20px/1.5 Georgia">f</span></p>`,
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "margin", count: 1 }),
      expect.objectContaining({ code: "html-style-unsupported", property: "background", count: 1 }),
      expect.objectContaining({ code: "html-style-unsupported", property: "font", count: 1 }),
    ]);
  });

  it("a value no rule takes is reported, though its property is supported", async () => {
    const diagnostics = await diagnosticsOf(
      `<p><span style="font-size: large">a</span><span style="font-size: 120%">b</span>` +
        `<span style="text-decoration: underline dotted">c</span></p>`,
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "font-size", count: 2 }),
      expect.objectContaining({ code: "html-style-unsupported", property: "text-decoration", count: 1 }),
    ]);
  });

  it("a style is reported when the editor has no extension to hold it", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ color: false })] });
    const { diagnostics } = await importHtml(editor, `<body style="color:#333"><p style="color:red">r</p></body>`);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "color", count: 2 }),
    ]);
  });

  it("alignment on an inline element is reported — it aligns nothing", async () => {
    const diagnostics = await diagnosticsOf(`<p><span style="text-align:center">s</span></p>`);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "text-align", count: 1 }),
    ]);
  });

  it("a style a rule reads off another element than its own counts as read", async () => {
    expect(
      await diagnosticsOf(
        `<table><colgroup><col style="width:240px"><col style="width:80px"></colgroup>` +
          `<tr><td>a</td><td>b</td></tr></table>`,
      ),
    ).toEqual([]);
  });

  it("an element its rule turned down is not blamed on a URL it does not have", async () => {
    const [diagnostic] = await diagnosticsOf(`<p><b style="font-weight: normal">x</b></p>`);
    expect(diagnostic).toMatchObject({ code: "html-element-rejected", tag: "b" });
    expect(diagnostic?.message).not.toMatch(/URL/);
  });
});
