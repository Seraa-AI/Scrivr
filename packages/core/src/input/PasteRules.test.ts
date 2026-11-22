/**
 * Paste reads HTML with the schema's own parse rules, after cleaning away the
 * source editor's artefacts. What those rules make of common markup is what a
 * person sees land.
 */
import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser, type Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { Field } from "../extensions/built-in/Field";
import { cleanPastedHtml } from "./PasteTransformer";

const { schema } = new ExtensionManager([StarterKit, Field]);

function paste(html: string): Node {
  const root = document.createElement("div");
  root.innerHTML = html;
  cleanPastedHtml(root);
  return PMDOMParser.fromSchema(schema).parse(root);
}

function markAttrs(doc: Node, text: string, mark: string): unknown {
  let attrs: unknown = null;
  doc.descendants((node) => {
    if (node.isText && node.text === text) attrs = node.marks.find((m) => m.type.name === mark)?.attrs ?? null;
    return true;
  });
  return attrs;
}

const blocks = (doc: Node) => {
  const out: string[] = [];
  doc.forEach((node) => out.push(`${node.type.name}:${node.textContent}`));
  return out;
};

function marksOf(doc: Node, text: string): string[] {
  let names: string[] = [];
  doc.descendants((node) => {
    if (node.isText && node.text === text) names = node.marks.map((m) => m.type.name);
    return true;
  });
  return names;
}

describe("pasted divs", () => {
  it("a div holding text is a paragraph, with its alignment", () => {
    const doc = paste(`<div style="text-align:center">a</div><div>b</div>`);
    expect(blocks(doc)).toEqual(["paragraph:a", "paragraph:b"]);
    expect(doc.child(0).attrs["align"]).toBe("center");
  });

  it("an empty spacer div adds no blank line", () => {
    expect(blocks(paste(`<p>a</p><div></div><div style="clear:both"></div><p>b</p>`))).toEqual([
      "paragraph:a",
      "paragraph:b",
    ]);
  });

  it("a div holding only a line break is the empty line it shows", () => {
    expect(blocks(paste(`<p>a</p><div><br></div><p>b</p>`))).toEqual(["paragraph:a", "paragraph:", "paragraph:b"]);
  });

  it("a div holding only empty elements shows nothing and adds no blank line", () => {
    for (const empty of [`<span></span>`, `<a id="x"></a>`, `<input type="hidden">`, `<img>`]) {
      expect(blocks(paste(`<p>a</p><div>${empty}</div><p>b</p>`))).toEqual(["paragraph:a", "paragraph:b"]);
    }
  });

  it("a div holding only an inline atom, such as a field, is a paragraph", () => {
    const doc = paste(`<div style="text-align:center"><span data-field="signature" data-role="a"></span></div>`);
    expect(doc.child(0).type.name).toBe("paragraph");
    expect(doc.child(0).attrs["align"]).toBe("center");
    expect(doc.child(0).firstChild?.type.name).toBe("field");
  });

  it("an align attribute aligns a pasted paragraph, heading or div", () => {
    const doc = paste(`<p align="center">a</p><h2 align="right">b</h2><div align="justify">c</div>`);
    expect([0, 1, 2].map((i) => doc.child(i).attrs["align"])).toEqual(["center", "right", "justify"]);
  });

  it("the browser-prefixed and legacy centre keywords centre", () => {
    const doc = paste(`<p style="text-align:-webkit-center">a</p><div align="middle">b</div>`);
    expect([0, 1].map((i) => doc.child(i).attrs["align"])).toEqual(["center", "center"]);
  });

  it("an align attribute takes only HTML's values, and text-align only CSS's", () => {
    const doc = paste(`<p align="end">a</p><p align="-webkit-right">b</p><p style="text-align:middle">c</p>`);
    expect([0, 1, 2].map((i) => doc.child(i).attrs["align"])).toEqual(["left", "left", "left"]);
  });

  it("a text-align the browser cannot read leaves the align attribute; a keyword beats it", () => {
    const doc = paste(
      `<p align="center" style="text-align:bogus">a</p><p align="center" style="text-align:inherit">b</p>` +
        `<p align="center" style="text-align:match-parent">c</p>`,
    );
    expect([0, 1, 2].map((i) => doc.child(i).attrs["align"])).toEqual(["center", "left", "left"]);
  });

  it("a div whose blocks sit inside an inline wrapper is read through", () => {
    expect(blocks(paste(`<div><a href="https://x.y"><h2>T</h2><p>y</p></a></div>`))).toEqual([
      "heading:T",
      "paragraph:y",
    ]);
  });
});

describe("pasted formatting", () => {
  it("<font> carries colour, face and size", () => {
    expect(marksOf(paste(`<p><font color="#c00" face="Georgia" size="5">f</font></p>`), "f").sort()).toEqual([
      "color",
      "fontFamily",
      "fontSize",
    ]);
  });

  it("maps logical alignment keywords; margins are the source page's and are cleaned away", () => {
    const doc = paste(`<p style="margin-left:3em;text-align:end">a</p>`);
    expect(doc.child(0).attrs).toMatchObject({ indent: 0, align: "right" });
  });

  it("keeps a fractional pixel font size", () => {
    let size: unknown = null;
    paste(`<p><span style="font-size:14.5px">s</span></p>`).descendants((node) => {
      if (node.isText) size = node.marks.find((m) => m.type.name === "fontSize")?.attrs["size"];
      return true;
    });
    expect(size).toBe(14.5);
  });

  it("a span's background is the source page's, and is cleaned away", () => {
    expect(marksOf(paste(`<p><span style="background-color:#ff0">h</span></p>`), "h")).toEqual([]);
  });

  it("a font size of zero or less is no size", () => {
    for (const size of ["0", "-4px"]) {
      expect(markAttrs(paste(`<p><span style="font-size:${size}">s</span></p>`), "s", "fontSize")).toBeNull();
    }
  });

  it("a colour or size set to a CSS-wide keyword is not a value", () => {
    expect(markAttrs(paste(`<p><span style="color:inherit">s</span></p>`), "s", "color")).toBeNull();
    expect(markAttrs(paste(`<p><span style="font-size:inherit">s</span></p>`), "s", "fontSize")).toBeNull();
    expect(markAttrs(paste(`<p><span style="font-family:inherit">s</span></p>`), "s", "fontFamily")).toBeNull();
  });

  it("`initial` resets the colour, size and face the text would inherit", () => {
    const doc = paste(
      `<p><span style="color:#c00;font-size:20px;font-family:Georgia">a` +
        `<span style="color:initial;font-size:initial;font-family:initial">b</span></span></p>`,
    );
    expect(markAttrs(doc, "a", "color")).toMatchObject({ color: "#c00" });
    expect(markAttrs(doc, "b", "color")).toBeNull();
    expect(markAttrs(doc, "b", "fontSize")).toBeNull();
    expect(markAttrs(doc, "b", "fontFamily")).toBeNull();
  });

  it("`revert` on a span keeps what it inherits, as a browser does", () => {
    const doc = paste(`<p><span style="color:#c00;font-size:20px"><b style="color:revert;font-size:revert">b</b></span></p>`);
    expect(markAttrs(doc, "b", "color")).toMatchObject({ color: "#c00" });
    expect(markAttrs(doc, "b", "fontSize")).toMatchObject({ size: 20 });
  });

  it("normal weight and style undo the bold and italic around them", () => {
    const doc = paste(
      `<p><b>a<span style="font-weight:normal">b</span><span style="font-weight:300">c</span></b>` +
        `<i>d<span style="font-style:normal">e</span></i></p>`,
    );
    expect(marksOf(doc, "a")).toEqual(["bold"]);
    expect(marksOf(doc, "b")).toEqual([]);
    expect(marksOf(doc, "c")).toEqual([]);
    expect(marksOf(doc, "d")).toEqual(["italic"]);
    expect(marksOf(doc, "e")).toEqual([]);
  });

  it("a bold or italic tag set to normal weight or style is not bold or italic", () => {
    const doc = paste(
      `<p><b style="font-weight:300">a</b><strong style="font-weight:normal">b</strong>` +
        `<em style="font-style:normal">c</em><i style="font-style:NORMAL">d</i>` +
        `<b>e<span style="font-weight:NORMAL">f</span></b></p>`,
    );
    for (const text of ["a", "b", "c", "d", "f"]) expect(marksOf(doc, text)).toEqual([]);
    expect(marksOf(doc, "e")).toEqual(["bold"]);
  });

  it("a tag set to normal still undoes the bold or italic around it, and keeps its other styles", () => {
    const doc = paste(
      `<p><strong>a<b style="font-weight:normal">b</b></strong><em>c<i style="font-style:normal">d</i></em>` +
        `<b style="font-weight:normal;color:#ff0000">e</b></p>`,
    );
    expect(marksOf(doc, "b")).toEqual([]);
    expect(marksOf(doc, "d")).toEqual([]);
    expect(marksOf(doc, "e")).toEqual(["color"]);
  });

  it("any weight from 500 up is bold", () => {
    expect(marksOf(paste(`<p><span style="font-weight:1000">a</span></p>`), "a")).toEqual(["bold"]);
  });
});
