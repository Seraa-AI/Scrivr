import { describe, expect, it } from "vitest";
import { DOMSerializer } from "prosemirror-model";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";

const orderedFrom = (order: number) => new ServerEditor({
  extensions: [StarterKit],
  content: { type: "doc", content: [{
    type: "orderedList",
    attrs: { order },
    content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }],
  }] },
});

/** The `start` an ordered list writes into copied HTML. */
function htmlStart(editor: ServerEditor): string | null {
  const list = editor.getState().doc.firstChild;
  if (!list) throw new Error("no list");
  const dom = DOMSerializer.fromSchema(editor.getState().schema).serializeNode(list);
  return dom instanceof HTMLElement ? dom.getAttribute("start") : null;
}

describe("where an ordered list starts, in every format it is written to", () => {
  it("numbers from 0 in markdown as on the page", () => {
    expect(orderedFrom(0).getMarkdown().trim()).toBe("0. x");
  });

  it("keeps a huge start within the cap in markdown and in copied HTML", () => {
    const editor = orderedFrom(2147483647);
    expect(editor.getMarkdown().trim()).toBe("32767. x");
    expect(htmlStart(editor)).toBe("32767");
  });
});
