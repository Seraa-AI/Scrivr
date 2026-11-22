/**
 * Reading a list back out of a .docx.
 *
 * OOXML has no list element: a list is a run of paragraphs that happen to
 * share a `<w:numPr>`. Reconstructing the nesting is the List extension's
 * business because List is what declares those nodes exist — and a kit
 * without it should say so rather than quietly produce something else.
 */

import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { exportDocxBytes } from "../export/export";
import { importDocx } from "./import";
import { DocxImportError } from "./error";

const listDoc = {
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    },
  ],
};

async function bytesOf(content: Record<string, unknown>): Promise<Uint8Array> {
  const editor = new ServerEditor();
  editor.setContent(content);
  return exportDocxBytes(editor);
}

/** A kit that does not declare list nodes at all. */
const withoutLists = () =>
  new ServerEditor({ extensions: [StarterKit.configure({ list: false })] });

describe("list import", () => {
  it("round-trips a bullet list", async () => {
    const { doc, diagnostics } = await importDocx(new ServerEditor(), await bytesOf(listDoc));
    const list = doc.child(0);
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("one");
    expect(list.child(1).textContent).toBe("two");
    expect(diagnostics).toEqual([]);
  });

  it("round-trips an ordered list", async () => {
    const ordered = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
          ],
        },
      ],
    };
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(ordered));
    expect(doc.child(0).type.name).toBe("orderedList");
    expect(doc.child(0).textContent).toBe("first");
  });

  it("round-trips items Tab took past the item above, each at its own level", async () => {
    const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const deeper = (text: string, levelOffset: number) => ({ type: "listItem", attrs: { levelOffset }, content: [para(text)] });
    const skipping = {
      type: "doc",
      content: [{ type: "bulletList", content: [
        { type: "listItem", content: [para("one")] },
        deeper("deep", 2),
        { type: "listItem", content: [para("back")] },
      ] }],
    };
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(skipping));
    const levels: Array<[string, number]> = [];
    doc.descendants((node) => {
      if (node.type.name === "listItem") levels.push([node.textContent, Number(node.attrs["levelOffset"])]);
    });
    // Word reads "deep" two levels below "one"; "back" is at the top level again.
    expect(levels.map(([text]) => text)).toEqual(["onedeep", "deep", "back"]);
    expect(levels.find(([text]) => text === "deep")?.[1]).toBe(1);
  });

  it("round-trips where an ordered list starts", async () => {
    const from = { type: "doc", content: [{ type: "orderedList", attrs: { order: 7 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "seventh" }] }] },
    ] }] };
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(from));
    expect(doc.child(0).attrs["order"]).toBe(7);
  });

  it("reads numId 0, Word's \"no numbering\", as a plain paragraph", async () => {
    const entries = unzipSync(await bytesOf(listDoc));
    const document = strFromU8(entries["word/document.xml"] ?? new Uint8Array());
    const unnumbered = document.replace(/<w:numId w:val="\d+"\/>/g, '<w:numId w:val="0"/>');
    const { doc } = await importDocx(new ServerEditor(), zipSync({ ...entries, "word/document.xml": strToU8(unnumbered) }));
    expect(doc.child(0).type.name).toBe("paragraph");
    expect(doc.child(0).textContent).toBe("one");
  });

  it("reports a list it cannot model, rather than dropping it quietly", async () => {
    // Moving the handler onto the extension changed which diagnostic this
    // produces: a kit that cannot model a list now says the block is
    // unsupported, which is in the fatal set, where the old package-level
    // builder reported a schema gap that was not.
    const { diagnostics } = await importDocx(withoutLists(), await bytesOf(listDoc));
    expect(diagnostics.map((d) => d.code)).toContain("unsupported-block");
  });

  it("refuses the document under unsupported: throw", async () => {
    // The consequence of the line above, stated on purpose: a strict caller
    // used to accept a file whose lists had silently gone missing.
    await expect(
      importDocx(withoutLists(), await bytesOf(listDoc), { unsupported: "throw" }),
    ).rejects.toThrow(DocxImportError);
  });
});

describe("list import keeps every item's text", () => {
  const item = (text: string, extra: Record<string, unknown> = {}, nested?: Record<string, unknown>) => ({
    type: "listItem",
    ...extra,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...(nested ? [nested] : [])],
  });
  const textOf = async (bytes: Uint8Array) => (await importDocx(new ServerEditor(), bytes)).doc.textContent;

  it("keeps the items after a list's first one when it starts deeper than they do", async () => {
    const bytes = await bytesOf({ type: "doc", content: [{ type: "orderedList", content: [item("first"), item("second"), item("third")] }] });
    const files = unzipSync(bytes);
    // Word writes the first paragraph a level deeper than the rest, under the same numbering.
    const document = strFromU8(files["word/document.xml"]!).replace('<w:ilvl w:val="0"/>', '<w:ilvl w:val="1"/>');
    expect(await textOf(zipSync({ ...files, "word/document.xml": strToU8(document) }))).toBe("firstsecondthird");
  });

  it("keeps a nested item under an item that starts deeper, at the depth it was drawn", async () => {
    const nested = { type: "orderedList", content: [item("n")] };
    const original = { type: "doc", content: [{ type: "orderedList", content: [item("top", { attrs: { levelOffset: 2 } }, nested)] }] };
    const bytes = await bytesOf(original);
    expect(await textOf(bytes)).toBe("topn");

    // Word's paragraphs are flat (level 2, then level 1), so the nesting itself
    // cannot come back; each item comes back at the depth it was drawn at.
    const { doc } = await importDocx(new ServerEditor(), bytes);
    expect(doc.child(0).child(0).attrs["levelOffset"]).toBe(2);
    expect(doc.child(1).child(0).attrs["levelOffset"]).toBe(1);
  });

  it("imports a list level Word cannot have, without hanging", async () => {
    const bytes = await bytesOf({ type: "doc", content: [{ type: "bulletList", content: [item("a"), item("b")] }] });
    const files = unzipSync(bytes);
    const document = strFromU8(files["word/document.xml"]!).replace('<w:ilvl w:val="0"/>', '<w:ilvl w:val="-1"/>');
    expect(await textOf(zipSync({ ...files, "word/document.xml": strToU8(document) }))).toBe("ab");
  });
});

describe("list numbering, as Word counts it", () => {
  const li = (text: string, nested?: Record<string, unknown>) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...(nested ? [nested] : [])],
  });
  const ordersOf = (node: { descendants: (f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void }) => {
    const orders: unknown[] = [];
    node.descendants((n) => { if (n.type.name === "orderedList") orders.push(n.attrs["order"]); });
    return orders;
  };

  it("restarts an ordered list nested under a bullet list, there and back", async () => {
    const original = { type: "doc", content: [{ type: "orderedList", content: [
      li("A", { type: "bulletList", content: [
        li("b1", { type: "orderedList", content: [li("x"), li("y")] }),
        li("b2", { type: "orderedList", content: [li("z")] }),
      ] }),
    ] }] };
    const { doc } = await importDocx(new ServerEditor(), await bytesOf(original));
    expect(ordersOf(doc)).toEqual([1, 1, 1]);
  });

  it("counts a level Word draws no number for, so the levels under it restart", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const bytes = await bytesOf({ type: "doc", content: [{ type: "orderedList", content: [
      li("Ch1", { type: "orderedList", content: [li("a"), li("b")] }),
      li("Ch2", { type: "orderedList", content: [li("c")] }),
    ] }] });
    const files = unzipSync(bytes);
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="1">`
      + `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/></w:lvl>`
      + `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const { doc } = await importDocx(new ServerEditor(), zipSync({ ...files, "word/numbering.xml": strToU8(numbering) }));
    expect(doc.textContent).toBe("Ch1abCh2c");
    // Each chapter is a plain paragraph, wherever it falls; only its sections are numbered.
    expect(doc.content.content.map((n) => n.type.name)).toEqual(["paragraph", "orderedList", "paragraph", "orderedList"]);
    expect(ordersOf(doc)).toEqual([1, 1]);
  });

  it("draws no number for a level formatted none in the middle of a list", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const bytes = await bytesOf({ type: "doc", content: [{ type: "orderedList", content: [
      li("one", { type: "orderedList", content: [li("sub", { type: "orderedList", content: [li("deep")] })] }),
    ] }] });
    const files = unzipSync(bytes);
    const lvl = (ilvl: number, fmt: string) => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/></w:lvl>`;
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="1">${lvl(0, "decimal")}${lvl(1, "none")}${lvl(2, "decimal")}</w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const { doc } = await importDocx(new ServerEditor(), zipSync({ ...files, "word/numbering.xml": strToU8(numbering) }));
    const kinds: string[] = [];
    doc.descendants((n) => { if (n.type.name.endsWith("List")) kinds.push(n.type.name); });
    expect(kinds).not.toContain("bulletList");
    expect(doc.textContent).toBe("onesubdeep");
  });

  it("keeps the first number of a list nested under a bullet list, there and back", async () => {
    const bytes = await bytesOf({ type: "doc", content: [{ type: "bulletList", content: [
      li("A", { type: "orderedList", attrs: { order: 5 }, content: [li("x"), li("y")] }),
      li("B", { type: "orderedList", attrs: { order: 3 }, content: [li("z")] }),
    ] }] });
    expect(strFromU8(unzipSync(bytes)["word/numbering.xml"]!)).toContain('<w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/>');
    const { doc } = await importDocx(new ServerEditor(), bytes);
    expect(ordersOf(doc)).toEqual([5, 3]);
  });

  it("never points a start at a level Word does not have, however deep the nesting", async () => {
    let list: Record<string, unknown> = { type: "orderedList", attrs: { order: 4 }, content: [li("bottom")] };
    for (let depth = 0; depth < 10; depth++) {
      list = { type: depth % 2 === 0 ? "bulletList" : "orderedList", content: [li(`l${depth}`, list)] };
    }
    const numbering = strFromU8(unzipSync(await bytesOf({ type: "doc", content: [list] }))["word/numbering.xml"]!);
    const levels = [...numbering.matchAll(/<w:lvlOverride w:ilvl="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...levels)).toBeLessThanOrEqual(8);
  });

  it("numbers a level that names no format as decimal, as Word does", async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const bytes = await bytesOf({ type: "doc", content: [{ type: "orderedList", content: [
      li("H", { type: "orderedList", content: [li("s1"), li("s2")] }),
    ] }] });
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="1">`
      + `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/></w:lvl></w:abstractNum>`
      + `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const { doc } = await importDocx(new ServerEditor(), zipSync({ ...unzipSync(bytes), "word/numbering.xml": strToU8(numbering) }));
    expect(doc.content.content.map((n) => n.type.name)).toEqual(["paragraph", "orderedList"]);
  });
});
