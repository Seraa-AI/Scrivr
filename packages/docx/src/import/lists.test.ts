/**
 * Reading a list back out of a .docx.
 *
 * OOXML has no list element: a list is a run of paragraphs that happen to
 * share a `<w:numPr>`. Reconstructing the nesting is the List extension's
 * business because List is what declares those nodes exist — and a kit
 * without it should say so rather than quietly produce something else.
 */

import { describe, it, expect } from "vitest";
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
