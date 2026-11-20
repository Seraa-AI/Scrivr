/**
 * A model drafting HTML often styles it from a `<style>` block rather than
 * inline. Those rules apply as a browser would apply them — for the selectors
 * a drafted document uses — and the rest are reported.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { importHtml, type HtmlImportDiagnostic } from "./index";

async function load(html: string): Promise<{ doc: PmNode; diagnostics: HtmlImportDiagnostic[] }> {
  const editor = new ServerEditor({ extensions: [StarterKit] });
  return importHtml(editor, html);
}

function marksOf(doc: PmNode, text: string): Record<string, unknown> {
  let found: Record<string, unknown> = {};
  doc.descendants((node) => {
    if (node.isText && node.text === text) found = Object.fromEntries(node.marks.map((m) => [m.type.name, m.attrs]));
    return true;
  });
  return found;
}

function colorOf(doc: PmNode, text: string): unknown {
  let color: unknown = null;
  doc.descendants((node) => {
    if (node.isText && node.text === text) color = node.marks.find((m) => m.type.name === "color")?.attrs["color"];
    return true;
  });
  return color;
}

describe("<style> rules", () => {
  it("apply by class, type, id and their combinations", async () => {
    const { doc, diagnostics } = await load(
      `<style>
        .lead { text-align: center }
        h2 { text-align: right }
        #note { margin-left: 48px }
        p.quiet, h3 { color: #777 }
      </style>
      <p class="lead">a</p><h2>b</h2><p id="note">c</p><p class="quiet">d</p><h3>e</h3>`,
    );
    expect(diagnostics).toEqual([]);
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(doc.child(1).attrs["align"]).toBe("right");
    expect(doc.child(2).attrs["indent"]).toBe(2);
    expect(colorOf(doc, "d")).toBe("#777");
    expect(colorOf(doc, "e")).toBe("#777");
  });

  it("the more specific rule wins, and an inline style beats every rule", async () => {
    const { doc } = await load(
      `<style>p { color: red } .x { color: blue } p { color: green }</style>` +
        `<p class="x">a</p><p class="x" style="color: purple">b</p><p>c</p>`,
    );
    expect(colorOf(doc, "a")).toBe("blue");
    expect(colorOf(doc, "b")).toBe("purple");
    expect(colorOf(doc, "c")).toBe("green");
  });

  it("read from <head> in a whole document", async () => {
    const { doc, diagnostics } = await load(
      `<!doctype html><html><head><title>t</title><style>p { text-align: justify }</style></head>` +
        `<body><p>a</p></body></html>`,
    );
    expect(diagnostics).toEqual([]);
    expect(doc.child(0).attrs["align"]).toBe("justify");
  });

  it("an !important rule beats an inline style, as in a browser", async () => {
    const { doc } = await load(`<style>p { color: red !important }</style><p style="color: blue">a</p>`);
    expect(colorOf(doc, "a")).toBe("red");
  });

  it("applies a final rule left unclosed, as a browser does", async () => {
    const { doc } = await load(`<style>p { text-align: center</style><p>a</p>`);
    expect(doc.child(0).attrs["align"]).toBe("center");
  });

  it("keeps a declaration whose value holds a semicolon", async () => {
    const { doc, diagnostics } = await load(
      `<p style="background-image: url('data:image/png;base64,AA'); text-align: right">a</p>`,
    );
    expect(doc.child(0).attrs["align"]).toBe("right");
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "background-image" }),
    ]);
  });

  it("a selector the DOM cannot read is reported, and the rest still apply", async () => {
    const { doc, diagnostics } = await load(
      `<style>.2col { color: red } p { text-align: center }</style><p class="2col">a</p>`,
    );
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-selector-unsupported", selector: ".2col", count: 1 }),
    ]);
  });

  it("a selector list with an empty entry is invalid whole, as in a browser", async () => {
    const { doc, diagnostics } = await load(`<style>p, { color: red }</style><p>a</p>`);
    expect(colorOf(doc, "a")).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-selector-unsupported", selector: "p,", count: 1 }),
    ]);
  });

  it("reports selectors and at-rules it does not apply", async () => {
    const { doc, diagnostics } = await load(
      `<style>
        @media print { p { color: red } }
        p > span { color: blue }
        p:first-child { color: green }
      </style><p><span>a</span></p>`,
    );
    expect(colorOf(doc, "a")).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-selector-unsupported", selector: "@media print", count: 1 }),
      expect.objectContaining({ code: "html-selector-unsupported", selector: "p > span", count: 1 }),
      expect.objectContaining({ code: "html-selector-unsupported", selector: "p:first-child", count: 1 }),
    ]);
  });
});

describe("inherited styles", () => {
  it("body's font and colour reach the text, and its page margin is reported", async () => {
    const { doc, diagnostics } = await load(
      `<style>body { font-family: Georgia, serif; color: #333; margin: 40px }</style>` +
        `<p>a</p><p style="font-family: Courier">b</p>`,
    );
    expect(marksOf(doc, "a")).toMatchObject({ fontFamily: { family: "Georgia" }, color: { color: "#333" } });
    expect(marksOf(doc, "b")).toMatchObject({ fontFamily: { family: "Courier" } });
    expect(doc.child(0).attrs["indent"]).toBe(0);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "margin", count: 1 }),
    ]);
  });

  it("a container's alignment reaches its blocks, whatever body says", async () => {
    for (const html of [
      `<div style="text-align:center"><p>x</p></div>`,
      `<body style="color:#000"><div style="text-align:center"><p>x</p></div></body>`,
    ]) {
      const { doc, diagnostics } = await load(html);
      expect(doc.child(0).attrs["align"]).toBe("center");
      expect(diagnostics).toEqual([]);
    }
  });

  it("an element's own default beats what it inherits", async () => {
    const { doc, diagnostics } = await load(
      `<style>body { font-weight: normal; font-size: 12pt; color: #333 }</style>` +
        `<h1>T</h1><p><b>B</b> <a href="https://seraa.ai">L</a> t</p>`,
    );
    expect(marksOf(doc, "T")).not.toHaveProperty("fontSize");
    expect(marksOf(doc, "B")).toHaveProperty("bold");
    expect(marksOf(doc, "L")).toHaveProperty("link");
    expect(marksOf(doc, "L")).not.toHaveProperty("color");
    expect(marksOf(doc, " t")).toMatchObject({ color: { color: "#333" }, fontSize: { size: 16 } });
    expect(diagnostics).toEqual([]);
  });
});
