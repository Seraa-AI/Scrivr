import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { AllSelection, TextSelection, type Selection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
// Through the package entry, as a host composing its own extensions imports them.
import { NORMALIZATION_META, TrailingNode, Typography } from "../../index";

const p = (text = "") => ({ type: "paragraph", content: text ? [{ type: "text", text }] : undefined });

function editor(...content: object[]) {
  return new ServerEditor({ extensions: [StarterKit], content: { type: "doc", content } });
}
const blocks = (e: ServerEditor) => {
  const out: string[] = [];
  e.getState().doc.forEach(node => out.push(`${node.type.name}:${node.textContent}`));
  return out;
};
const caretAt = (e: ServerEditor, pos: number) =>
  e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, pos)));
const select = (e: ServerEditor, selection: (doc: Node) => Selection) =>
  e.applyTransaction(e.getState().tr.setSelection(selection(e.getState().doc)));
const toParagraph = (e: ServerEditor) =>
  e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph));

describe("TrailingNode", () => {
  it("can be added by a host that leaves it out of StarterKit", () => {
    const e = new ServerEditor({ extensions: [StarterKit.configure({ trailingNode: false }), TrailingNode, Typography], content: { type: "doc", content: [p("one")] } });
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
  });

  it("adds a paragraph after a last block that is not one", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
  });

  it("takes its paragraph away once the last block is a paragraph again", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.commands.setParagraph();
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("keeps the paragraph once someone has typed in it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    const end = e.getState().doc.content.size - 1;
    e.applyTransaction(e.getState().tr.insertText("two", end));
    caretAt(e, 2);
    e.commands.setParagraph();
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:two"]);
  });

  it("keeps the paragraph for someone already in it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    caretAt(e, e.getState().doc.content.size - 1);
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph));
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("keeps a paragraph someone was in after they click away and back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    const end = e.getState().doc.content.size - 1;
    caretAt(e, end);
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph));
    caretAt(e, 2);
    caretAt(e, end);
    e.applyTransaction(e.getState().tr.insertText("!", 2));
    expect(blocks(e)).toEqual(["paragraph:o!ne", "paragraph:"]);
  });

  it("takes the paragraph away from a caret the edit moved into it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    const tr = e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph);
    e.applyTransaction(tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)));
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("marks what it adds and takes away as an edit nobody authored", () => {
    const e = editor(p("one"));
    const added = e.getState().applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.heading, { level: 1 }));
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.heading, { level: 1 }));
    const removed = e.getState().applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph));

    for (const { transactions } of [added, removed]) {
      const appended = transactions.slice(1).filter(tr => tr.docChanged);
      expect(appended.length).toBeGreaterThan(0);
      expect(appended.every(tr => tr.getMeta(NORMALIZATION_META))).toBe(true);
    }
  });

  it("takes its paragraph away after Select All", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    select(e, doc => new AllSelection(doc));
    toParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away after a selection that only runs into it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    select(e, doc => TextSelection.create(doc, 1, doc.content.size - 1));
    toParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away again after an undo brings it back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.applyTransaction(closeHistory(e.getState().tr));
    toParagraph(e);
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    toParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away again after a redo brings it back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.commands.undo();
    e.commands.redo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    toParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it.each([
    { last: { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("a")] }] }] }, expected: ["paragraph:one", "table:a", "paragraph:"] },
    { last: { type: "horizontalRule" }, expected: ["paragraph:one", "horizontalRule:", "paragraph:"] },
    { last: { type: "pageBreak" }, expected: ["paragraph:one", "pageBreak:", "paragraph:"] },
  ])("adds a paragraph after a document ending in a $last.type", ({ last, expected }) => {
    const e = new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content: { type: "doc", content: [p("one"), last] } });
    e.applyTransaction(e.getState().tr);
    expect(blocks(e)).toEqual(expected);
  });

  it("leaves an empty last paragraph it did not add", () => {
    const e = editor(p("one"), p());
    caretAt(e, 2);
    e.applyTransaction(e.getState().tr.insertText("!", 4));
    expect(blocks(e)).toEqual(["paragraph:one!", "paragraph:"]);
  });
});
