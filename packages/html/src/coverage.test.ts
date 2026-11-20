/**
 * HTML a person or a model writes, for formatting the schema already holds.
 * Each case reads into the document and reports nothing dropped.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { importHtml } from "./index";

async function load(html: string): Promise<PmNode> {
  const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
  const { doc, diagnostics } = await importHtml(editor, html);
  expect(diagnostics).toEqual([]);
  return doc;
}

function marksOf(doc: PmNode, text: string): Record<string, unknown> {
  let found: Record<string, unknown> | null = null;
  doc.descendants((node) => {
    if (node.isText && node.text === text) {
      found = Object.fromEntries(node.marks.map((m) => [m.type.name, m.attrs]));
    }
    return found === null;
  });
  if (found === null) throw new Error(`no text node "${text}"`);
  return found;
}

describe("HTML formatting the schema holds", () => {
  it("a background colour on a span is a highlight", async () => {
    const doc = await load(`<p><span style="background-color:#ff0">h</span> plain</p>`);
    expect(marksOf(doc, "h")).toHaveProperty("highlight");
    expect(marksOf(doc, " plain")).not.toHaveProperty("highlight");
  });

  it("indents in any CSS length unit", async () => {
    const doc = await load(
      `<p style="margin-left:0.5in;text-indent:18pt">a</p>` + `<p style="margin-left:3em">b</p>`,
    );
    expect(doc.child(0).attrs).toMatchObject({ indent: 2, textIndent: 24 });
    expect(doc.child(1).attrs).toMatchObject({ indent: 2 });
  });

  it("a font size in em or rem is relative to the 16px default", async () => {
    const doc = await load(`<p><span style="font-size:1.5em">a</span><span style="font-size:0.75rem">b</span></p>`);
    expect(marksOf(doc, "a")).toMatchObject({ fontSize: { size: 24 } });
    expect(marksOf(doc, "b")).toMatchObject({ fontSize: { size: 12 } });
  });

  it("alignment keywords map onto the four the editor has", async () => {
    const doc = await load(
      `<p style="text-align:justify">a</p><p style="text-align:start">b</p>` +
        `<p style="text-align:end">c</p><h2 style="text-align:end">d</h2>`,
    );
    expect([0, 1, 2, 3].map((i) => doc.child(i).attrs["align"])).toEqual(["justify", "left", "right", "right"]);
  });

  it("<font> carries colour, face and size", async () => {
    const doc = await load(`<p><font color="#c00" face="Georgia, serif" size="5">f</font></p>`);
    expect(marksOf(doc, "f")).toMatchObject({
      color: { color: "#c00" },
      fontFamily: { family: "Georgia" },
      fontSize: { size: 24 },
    });
  });

  it("a block's text styles apply to its text", async () => {
    const doc = await load(
      `<p style="color:#c00;font-weight:bold">p</p>` +
        `<table><tr><td style="font-style:italic">c</td></tr></table>`,
    );
    expect(marksOf(doc, "p")).toHaveProperty("color");
    expect(marksOf(doc, "p")).toHaveProperty("bold");
    expect(marksOf(doc, "c")).toHaveProperty("italic");
  });

  it("a <div> holding text is a paragraph, with its alignment", async () => {
    const doc = await load(`<div style="text-align:center">a</div><div>b</div>`);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("paragraph");
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(doc.child(1).textContent).toBe("b");
  });

  it("a cell's fill reads as the cell's background", async () => {
    const doc = await load(`<table><tr><td style="background-color:#eeeeee">c</td></tr></table>`);
    let background: unknown = null;
    doc.descendants((node) => {
      if (node.type.name === "tableCell") background = node.attrs["background"];
      return true;
    });
    expect(background).toEqual(expect.stringMatching(/^#?eeeeee$/i));
  });
});
