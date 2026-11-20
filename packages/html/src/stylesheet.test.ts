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

  it("body's inherited properties reach its blocks, beneath their own", async () => {
    const { doc, diagnostics } = await load(
      `<style>body { font-family: Georgia, serif; margin: 40px }</style>` +
        `<p>a</p><p style="font-family: Courier">b</p>`,
    );
    expect(doc.child(0).attrs["fontFamily"]).toBe("Georgia");
    expect(doc.child(1).attrs["fontFamily"]).toBe("Courier");
    // `margin` is the page's, not a paragraph's — it is not handed down.
    expect(doc.child(0).attrs["indent"]).toBe(0);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "html-style-unsupported", property: "margin", count: 1 }),
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
