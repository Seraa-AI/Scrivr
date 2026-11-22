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

describe("a heading in a list, as Word makes one", () => {
  const headingDoc = () => new ServerEditor({
    extensions: [StarterKit],
    content: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scope" }] }] },
  });

  const toggles: Array<"toggleBulletList" | "toggleOrderedList"> = ["toggleBulletList", "toggleOrderedList"];
  it.each(toggles)("%s makes a heading a list item and keeps it a heading", (command) => {
    const editor = headingDoc();
    expect(editor.runCommand(command)).toBe(true);

    const item = editor.getState().doc.child(0).child(0);
    expect(item.type.name).toBe("listItem");
    expect(item.child(0).type.name).toBe("heading");
    expect(item.child(0).attrs["level"]).toBe(2);
  });

  it("lifts it back out of the list as a heading", () => {
    const editor = headingDoc();
    editor.runCommand("toggleBulletList");
    editor.runCommand("toggleBulletList");
    expect(editor.getState().doc.child(0).type.name).toBe("heading");
  });
});
