import { describe, expect, it } from "vitest";
import { DOMSerializer } from "prosemirror-model";
import { TextSelection, type Transaction } from "prosemirror-state";
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

  it("joins a typed '32768. ' onto a list showing 32767, as its numbers read", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [
        { type: "orderedList", attrs: { order: 40000 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "32768." }] },
      ] },
    });
    const end = editor.getState().doc.content.size - 1;
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, end)));
    const rules = editor.getState().plugins.find((plugin) => plugin.spec.isInputRules);
    const handleTextInput = rules?.props.handleTextInput;
    if (!handleTextInput) throw new Error("no input rules");
    // Input rules run from a view; a headless editor stands in with its state and dispatch.
    const view = { state: editor.getState(), composing: false, dispatch: (tr: Transaction) => editor.applyTransaction(tr) };
    expect(Reflect.apply(handleTextInput, rules, [view, end, end, " ", () => null])).toBe(true);

    const lists: number[] = [];
    editor.getState().doc.forEach((node) => {
      if (node.type.name === "orderedList") lists.push(node.childCount);
    });
    expect(lists).toEqual([2]);
  });
});
