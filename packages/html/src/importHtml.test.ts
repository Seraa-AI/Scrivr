/**
 * An agent drafts on the server and hands Scrivr HTML. What the schema can
 * hold has to arrive: structure, block attributes, every mark, and the ids an
 * agent uses to refer back to what it wrote.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit, applyImportedDocument } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { importHtml } from "./importHtml";

// Tables are opt-in; a drafting editor turns them on.
const extensions = [StarterKit.configure({ table: true })];

async function load(html: string): Promise<PmNode> {
  const editor = new ServerEditor({ extensions });
  const { doc } = await importHtml(editor, html);
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

describe("importHtml — on the server", () => {
  it("reads headings, paragraphs and their block attributes", async () => {
    const doc = await load(
      `<h2 style="text-align:center">Title</h2>` +
        `<p style="text-align:right;margin-left:48px;text-indent:24px;font-family:'Georgia', serif">Body</p>`,
    );
    const [heading, paragraph] = [doc.child(0), doc.child(1)];
    expect(heading.type.name).toBe("heading");
    expect(heading.attrs).toMatchObject({ level: 2, align: "center" });
    expect(paragraph.attrs).toMatchObject({
      align: "right",
      indent: 2,
      textIndent: 24,
      fontFamily: "Georgia",
    });
  });

  it("reads every inline mark the schema has", async () => {
    const doc = await load(
      `<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> ` +
        `<mark style="background-color:#ff0">h</mark> ` +
        `<span style="color:#c00">c</span> ` +
        `<span style="font-size:18px">z</span> ` +
        `<span style="font-family:Courier">f</span> ` +
        `<a href="https://seraa.ai">l</a></p>`,
    );
    expect(marksOf(doc, "b")).toHaveProperty("bold");
    expect(marksOf(doc, "i")).toHaveProperty("italic");
    expect(marksOf(doc, "u")).toHaveProperty("underline");
    expect(marksOf(doc, "s")).toHaveProperty("strikethrough");
    expect(marksOf(doc, "h")).toHaveProperty("highlight");
    expect(marksOf(doc, "c")).toHaveProperty("color");
    expect(marksOf(doc, "z")).toHaveProperty("fontSize");
    expect(marksOf(doc, "f")).toHaveProperty("fontFamily");
    expect(marksOf(doc, "l")).toMatchObject({ link: { href: "https://seraa.ai" } });
  });

  it("reads lists, tables, rules, breaks and images", async () => {
    const doc = await load(
      `<ul><li><p>one</p></li></ul>` +
        `<ol><li><p>two</p></li></ol>` +
        `<table><tr><th>H</th></tr><tr><td>C</td></tr></table>` +
        `<hr>` +
        `<p>a<br>b</p>` +
        `<p><img src="https://seraa.ai/logo.png" width="40" height="20"></p>`,
    );
    const types: string[] = [];
    doc.descendants((node) => {
      types.push(node.type.name);
      return true;
    });
    for (const type of [
      "bulletList",
      "orderedList",
      "listItem",
      "table",
      "tableHeader",
      "tableCell",
      "horizontalRule",
      "hardBreak",
      "image",
    ]) {
      expect(types).toContain(type);
    }
  });

  it("drops a link whose href is not safe, keeping its text", async () => {
    const doc = await load(`<p><a href="javascript:alert(1)">x</a></p>`);
    expect(marksOf(doc, "x")).not.toHaveProperty("link");
  });

  it("keeps the ids the HTML carries and gives the rest new ones", async () => {
    const doc = await load(
      `<p data-node-id="intro">a</p><p>b</p>`,
    );
    expect(doc.child(0).attrs["nodeId"]).toBe("intro");
    expect(doc.child(1).attrs["nodeId"]).toEqual(expect.any(String));
  });

  it("keeps the first of two blocks sharing an id and re-ids the second", async () => {
    const doc = await load(
      `<p data-node-id="same">a</p><p data-node-id="same">b</p>`,
    );
    expect(doc.child(0).attrs["nodeId"]).toBe("same");
    expect(doc.child(1).attrs["nodeId"]).not.toBe("same");
    expect(doc.child(1).attrs["nodeId"]).toEqual(expect.any(String));
  });

  it("loads into an editor as one non-authored replacement", async () => {
    const editor = new ServerEditor({ extensions });
    const { doc } = await importHtml(editor, `<h1>Draft</h1><p>Body</p>`);
    applyImportedDocument(editor, doc);
    expect(editor.getState().doc.child(0).textContent).toBe("Draft");
    expect(editor.getState().doc.child(1).textContent).toBe("Body");
  });
});
