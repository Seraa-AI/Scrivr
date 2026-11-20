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

  it("a background no one can see is not a highlight", async () => {
    for (const background of ["rgba(0, 0, 0, 0)", "transparent", "inherit", "initial"]) {
      const doc = await load(`<p><span style="background-color:${background}">h</span></p>`);
      expect(marksOf(doc, "h")).not.toHaveProperty("highlight");
    }
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

  it("Word's cell widths are the table's column widths", async () => {
    const doc = await load(`<table><tr><td style="width:100pt">a</td><td style="width:200pt">b</td></tr></table>`);
    const grid: unknown = doc.child(0).attrs["grid"];
    expect(grid).toEqual([expect.closeTo(133.33, 1), expect.closeTo(266.67, 1)]);
  });
});

describe("what an element states beats what it inherits", () => {
  it("an align attribute aligns a paragraph, heading or div of text", async () => {
    const doc = await load(`<p align="right">p</p><h1 align="center">h</h1><div align="justify">d</div>`);
    expect([0, 1, 2].map((i) => doc.child(i).attrs["align"])).toEqual(["right", "center", "justify"]);
  });

  it("an align the browser ignores leaves the inherited alignment", async () => {
    for (const align of [``, `bogus`]) {
      const doc = await load(`<div style="text-align:center"><p align="${align}">a</p></div>`);
      expect(doc.child(0).attrs["align"]).toBe("center");
    }
  });

  it("an align attribute HTML ignores aligns nothing, and an inline style beats it", async () => {
    const ignored = await load(`<p align="end">a</p>`);
    expect(ignored.child(0).attrs["align"]).toBe("left");
    const inherited = await load(`<div style="text-align:center"><p style="text-align:inherit" align="right">a</p></div>`);
    expect(inherited.child(0).attrs["align"]).toBe("center");
  });

  it("text-align: inherit keeps what the block inherits", async () => {
    for (const keyword of ["inherit", "unset"]) {
      const doc = await load(`<div style="text-align:center"><p style="text-align:${keyword}">a</p></div>`);
      expect(doc.child(0).attrs["align"]).toBe("center");
    }
  });

  it("align=middle centres a cell, and -webkit-center centres a paragraph", async () => {
    const doc = await load(
      `<p style="text-align:-webkit-center">p</p><table><tr><td align="middle">c</td></tr></table>`,
    );
    const aligns: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === "paragraph") aligns.push(node.attrs["align"]);
      return true;
    });
    expect(aligns).toEqual(["center", "center"]);
  });

  it("a heading's align beats its container's", async () => {
    const doc = await load(`<div style="text-align:center"><h1 align="right">H</h1></div>`);
    expect(doc.child(0).attrs["align"]).toBe("right");
  });

  it("<font> keeps its colour, face and size under a page style", async () => {
    const doc = await load(
      `<body style="color:#333333;font-family:Georgia;font-size:10px">` +
        `<p><font color="#ff0000" face="Arial" size="5">f</font> rest</p></body>`,
    );
    expect(marksOf(doc, "f")).toMatchObject({
      color: { color: "#ff0000" },
      fontFamily: { family: "Arial" },
      fontSize: { size: 24 },
    });
    expect(marksOf(doc, " rest")).toMatchObject({ color: { color: "#333333" }, fontSize: { size: 10 } });
  });

  it("a cell's align attribute beats its container's alignment", async () => {
    const doc = await load(`<div style="text-align:left"><table><tr><td align="center">x</td></tr></table></div>`);
    let cell: Record<string, unknown> = {};
    let paragraph: Record<string, unknown> = {};
    doc.descendants((node) => {
      if (node.type.name === "tableCell") cell = node.attrs;
      if (node.type.name === "paragraph") paragraph = node.attrs;
      return true;
    });
    expect(cell["hAlign"]).toBe("center");
    expect(paragraph["align"]).toBe("center");
  });

  it("a wrapper's page styles leave a heading its size and a link its colour", async () => {
    const doc = await load(
      `<div style="color:#333333;font-size:12px"><h1>T</h1><p><a href="https://seraa.ai">L</a> t</p></div>`,
    );
    expect(marksOf(doc, "T")).not.toHaveProperty("fontSize");
    expect(marksOf(doc, "T")).toHaveProperty("color");
    expect(marksOf(doc, "L")).not.toHaveProperty("color");
    expect(marksOf(doc, "L")).toHaveProperty("fontSize");
    expect(marksOf(doc, " t")).toMatchObject({ color: { color: "#333333" }, fontSize: { size: 12 } });
  });

  it("the space between two formatted words takes the page's size too", async () => {
    const doc = await load(`<body style="font-size:24px"><p><b>Hello</b> <i>world</i></p></body>`);
    expect(marksOf(doc, " ")).toMatchObject({ fontSize: { size: 24 } });
  });
});

describe("alignment reaches text that sits straight in its container", () => {
  it("in the page, a list item, a cell, and beside a block", async () => {
    const page = await load(`<body style="text-align:center">Hello</body>`);
    expect(page.child(0).attrs["align"]).toBe("center");

    const item = await load(`<ul><li style="text-align:center">Item</li></ul>`);
    expect(item.child(0).child(0).child(0).attrs["align"]).toBe("center");

    const mixed = await load(`<div style="text-align:center">loose <b>bold</b><p>wrapped</p></div>`);
    expect(mixed.childCount).toBe(2);
    expect(mixed.child(0).textContent).toBe("loose bold");
    expect([0, 1].map((i) => mixed.child(i).attrs["align"])).toEqual(["center", "center"]);
  });

  it("a table's column widths and rows survive an alignment reaching it", async () => {
    for (const html of [
      `<table style="text-align:center">`,
      `<table align="left">`,
      `<div style="text-align:center"><table>`,
    ]) {
      const doc = await load(
        `${html}<colgroup><col width="100"><col width="200"></colgroup><tr><td>a</td><td>b</td></tr></table>`,
      );
      const table = doc.child(0);
      expect(table.childCount).toBe(1);
      expect(table.attrs["grid"]).toHaveLength(2);
    }
  });

  it("a table's align does not align the text in its cells", async () => {
    const doc = await load(`<table align="center"><tr><td>x</td></tr></table>`);
    let align: unknown = null;
    doc.descendants((node) => {
      if (node.type.name === "paragraph") align = node.attrs["align"];
      return true;
    });
    expect(align).toBe("left");
  });

  it("a row's or row group's align aligns its cells' text", async () => {
    for (const html of [
      `<table><tr align="center"><td>x</td></tr></table>`,
      `<table><tbody align="center"><tr><td>x</td></tr></tbody></table>`,
    ]) {
      let align: unknown = null;
      (await load(html)).descendants((node) => {
        if (node.type.name === "paragraph") align = node.attrs["align"];
        return true;
      });
      expect(align).toBe("center");
    }
  });

  it("a cell holding a non-breaking space keeps the alignment that reaches it", async () => {
    let align: unknown = null;
    (await load(`<table style="text-align:center"><tr><td>&nbsp;</td></tr></table>`)).descendants((node) => {
      if (node.type.name === "paragraph") align = node.attrs["align"];
      return true;
    });
    expect(align).toBe("center");
  });

  it("a container with only empty elements in it adds no blank line", async () => {
    const doc = await load(`<p>a</p><div><span></span></div><div><b></b></div><p>b</p>`);
    expect(doc.childCount).toBe(2);
  });

  it("a number in a right-aligned cell is right-aligned", async () => {
    const doc = await load(`<table><tr><td style="text-align:right">42</td></tr></table>`);
    let align: unknown = null;
    doc.descendants((node) => {
      if (node.type.name === "paragraph") align = node.attrs["align"];
      return true;
    });
    expect(align).toBe("right");
  });
});
