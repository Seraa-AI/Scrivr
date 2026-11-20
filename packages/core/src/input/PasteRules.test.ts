/**
 * Paste reads HTML with the schema's own parse rules, after cleaning away the
 * source editor's artefacts. What those rules make of common markup is what a
 * person sees land.
 */
import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser, type Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { cleanPastedHtml } from "./PasteTransformer";

const { schema } = new ExtensionManager([StarterKit]);

function paste(html: string): Node {
  const root = document.createElement("div");
  root.innerHTML = html;
  cleanPastedHtml(root);
  return PMDOMParser.fromSchema(schema).parse(root);
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
});
