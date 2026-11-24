import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { closeHistory, isHistoryTransaction } from "prosemirror-history";
import { AllSelection, NodeSelection, Plugin, TextSelection, type Selection, type Transaction } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { Extension } from "../Extension";
import { StarterKit } from "../StarterKit";
// Through the package entry, as a host composing its own extensions imports them.
import { COLLAB_SYNC_META, NORMALIZATION_META, TrailingNode, Typography } from "../../index";

const h1 = (text: string) => ({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] });
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
const create = (e: ServerEditor, name: string) => {
  const type = e.getState().schema.nodes[name];
  if (!type) throw new Error(`no ${name} node`);
  return type.create();
};
const firstToParagraph = (e: ServerEditor) =>
  e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph));

const lastLinePos = (e: ServerEditor) => e.getState().doc.content.size - 2;
/** An edit that undoes on its own, apart from the one before it. */
const edit = (e: ServerEditor, change: (tr: Transaction) => Transaction) =>
  e.applyTransaction(closeHistory(change(e.getState().tr)));

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

  it("takes its paragraph away once the block above it is a paragraph again", () => {
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
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away after a selection that only runs into it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    select(e, doc => TextSelection.create(doc, 1, doc.content.size - 1));
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away again after an undo brings it back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    edit(e, tr => tr);
    firstToParagraph(e);
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away again after a redo brings it back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.commands.undo();
    e.commands.redo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("leaves a line it did not add alone through an undo of something else", () => {
    const e = editor(h1("one"), p());
    caretAt(e, 2);
    e.applyTransaction(closeHistory(e.getState().tr.insertText("X", 2)));
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("leaves a line someone typed in alone after undoing the typing", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.applyTransaction(closeHistory(e.getState().tr.insertText("x", e.getState().doc.content.size - 1)));
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("leaves a line it did not add alone when an undo takes away a paragraph after it", () => {
    const e = editor(h1("one"), p());
    const { tr } = e.getState();
    e.applyTransaction(closeHistory(tr.insert(tr.doc.content.size, create(e, "paragraph"))));
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("keeps the paragraph for someone who selects it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    select(e, doc => NodeSelection.create(doc, doc.content.size - 2));
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("keeps the paragraph someone was in after undo and redo take it away and back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.commands.undo();
    e.commands.redo();
    caretAt(e, e.getState().doc.content.size - 1);
    e.commands.undo();
    e.commands.redo();
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it.each<{ name: string; change: (e: ServerEditor) => void }>([
    { name: "a rule inserted before it", change: e => edit(e, tr => tr.insert(lastLinePos(e), create(e, "horizontalRule"))) },
    { name: "a heading inserted before it", change: e => edit(e, tr => tr.insert(lastLinePos(e), create(e, "heading"))) },
    { name: "a rule that replaced it", change: e => edit(e, tr => tr.replaceWith(lastLinePos(e), tr.doc.content.size, create(e, "horizontalRule"))) },
    { name: "turning it into a heading", change: e => { caretAt(e, lastLinePos(e) + 1); e.commands.setHeading({ level: 2 }); } },
    { name: "turning it into a list", change: e => { caretAt(e, lastLinePos(e) + 1); e.commands.toggleBulletList(); } },
    { name: "deleting it", change: e => edit(e, tr => tr.delete(lastLinePos(e), tr.doc.content.size)) },
    { name: "deleting it along with the heading", change: e => edit(e, tr => tr.delete(0, tr.doc.content.size)) },
  ])("leaves a line it did not add alone after an undo of $name", ({ change }) => {
    const e = editor(h1("one"), p());
    caretAt(e, 2);
    change(e);
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("does not take away a line a collaborator's sync brought", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    const { doc } = e.getState();
    e.applyTransaction(e.getState().tr.replaceWith(0, doc.content.size, doc.content).setMeta(COLLAB_SYNC_META, true));
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it.each([
    { ids: "with ids", starterKit: StarterKit },
    { ids: "without ids", starterKit: StarterKit.configure({ uniqueId: false }) },
  ])("still takes its paragraph away after an undo of something else, for blocks $ids", ({ starterKit }) => {
    const e = new ServerEditor({ extensions: [starterKit], content: { type: "doc", content: [p("one")] } });
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    edit(e, tr => tr.insertText("x", 1));
    e.commands.undo();
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("no longer takes its line away once an undo has put a paragraph below it", () => {
    const e = editor(p("one"), p("two"));
    const heading = 5;
    edit(e, tr => tr.delete(heading, tr.doc.content.size));
    e.applyTransaction(e.getState().tr.insert(heading, create(e, "heading")).setMeta("addToHistory", false));
    e.commands.undo();
    expect(blocks(e)).toEqual(["paragraph:one", "heading:", "paragraph:", "paragraph:two"]);
    e.commands.redo();
    expect(blocks(e)).toEqual(["paragraph:one", "heading:", "paragraph:"]);
    e.applyTransaction(e.getState().tr.setNodeMarkup(heading, e.getState().schema.nodes.paragraph));
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:", "paragraph:"]);
  });

  it("takes its paragraph away after an undo, a click elsewhere and a redo", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.commands.undo();
    caretAt(e, 3);
    e.commands.redo();
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("keeps the paragraph after an undo of a list it was made part of", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    edit(e, tr => tr);
    select(e, doc => new AllSelection(doc));
    e.commands.toggleBulletList();
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it("keeps the caret in the paragraph when a selection into it is deleted", () => {
    const e = editor(p("alpha"), h1("beta"));
    e.applyTransaction(e.getState().tr);
    select(e, doc => TextSelection.create(doc, 8, doc.content.size - 1));
    e.applyTransaction(e.getState().tr.deleteSelection());
    expect(blocks(e)).toEqual(["paragraph:alpha", "paragraph:"]);
    e.applyTransaction(e.getState().tr.insertText("new"));
    expect(blocks(e)).toEqual(["paragraph:alpha", "paragraph:new"]);
  });

  it("does not take away a copy of its paragraph that someone put back", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    const copied = e.getState().doc.slice(0, e.getState().doc.content.size);
    e.commands.setParagraph();
    edit(e, tr => tr.replace(0, tr.doc.content.size, copied));
    edit(e, tr => tr.insertText("x", 1));
    e.commands.undo();
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
  });

  it.each<{ name: string; change: (tr: Transaction) => Transaction }>([
    { name: "deleting everything", change: tr => tr.setSelection(new AllSelection(tr.doc)).deleteSelection() },
    { name: "typing over everything", change: tr => tr.setSelection(new AllSelection(tr.doc)).insertText("x") },
    { name: "deleting the line", change: tr => tr.delete(tr.doc.content.size - 2, tr.doc.content.size) },
  ])("takes its paragraph away again after an undo of $name", ({ change }) => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    edit(e, change);
    e.commands.undo();
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  describe("when an undo brings its line back where it is not needed", () => {
    function undoneAfterUnrecordedLoad(...extensions: Extension[]) {
      const e = new ServerEditor({ extensions: [StarterKit, ...extensions], content: { type: "doc", content: [p("one")] } });
      caretAt(e, 2);
      e.commands.setHeading({ level: 1 });
      edit(e, tr => tr);
      e.commands.setParagraph();
      const loaded = e.getState().schema.nodeFromJSON({ type: "doc", content: [h1("Demo"), p("body")] });
      e.applyTransaction(e.getState().tr.replaceWith(0, e.getState().doc.content.size, loaded.content).setMeta("addToHistory", false));
      e.commands.undo();
      return e;
    }

    it("can still undo", () => {
      const e = undoneAfterUnrecordedLoad();
      expect(blocks(e)).toEqual(["heading:Demo", "paragraph:body", "paragraph:"]);
      e.commands.undo();
      expect(blocks(e)).toEqual(["heading:Demo", "paragraph:body"]);
    });

    it("takes the line away at the next edit, not the next click", () => {
      const e = undoneAfterUnrecordedLoad();
      caretAt(e, 2);
      expect(blocks(e)).toEqual(["heading:Demo", "paragraph:body", "paragraph:"]);
      e.applyTransaction(e.getState().tr.insertText("!", 5));
      expect(blocks(e)).toEqual(["heading:Demo!", "paragraph:body"]);
    });

    it("leaves the line through what another plugin adds to the undo", () => {
      const marksUndo = Extension.create({
        name: "marksUndo",
        addProseMirrorPlugins: () => [new Plugin({
          appendTransaction: (transactions, _old, state) =>
            transactions.some(isHistoryTransaction) ? state.tr.insertText("!", 5) : null,
        })],
      });
      expect(blocks(undoneAfterUnrecordedLoad(marksUndo))).toEqual(["heading:Demo!", "paragraph:body", "paragraph:"]);
    });
  });

  it("takes its paragraph away when deleting the block above moves the caret into it", () => {
    const e = editor(p("alpha"), { type: "horizontalRule" });
    e.applyTransaction(e.getState().tr);
    select(e, doc => NodeSelection.create(doc, 7));
    e.applyTransaction(e.getState().tr.deleteSelection());
    expect(blocks(e)).toEqual(["paragraph:alpha"]);
  });

  it("takes its paragraph away when a change to everything moves the caret into it", () => {
    const e = editor(p("one"));
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    select(e, doc => new AllSelection(doc));
    const tr = e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.paragraph);
    e.applyTransaction(tr.setSelection(TextSelection.create(tr.doc, lastLinePos(e) + 1)));
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("takes its paragraph away when a deletion leaves Select All on", () => {
    const e = editor(p("alpha"), h1("beta"));
    e.applyTransaction(e.getState().tr);
    select(e, doc => new AllSelection(doc));
    e.applyTransaction(e.getState().tr.delete(7, lastLinePos(e)));
    expect(blocks(e)).toEqual(["paragraph:alpha"]);
  });

  it("takes its paragraph away when another plugin moves the caret after the edit", () => {
    const movesCaret = Extension.create({
      name: "movesCaret",
      addProseMirrorPlugins: () => [new Plugin({
        appendTransaction: (transactions, _old, state) =>
          transactions.every(tr => tr.docChanged) ? state.tr.setSelection(TextSelection.create(state.doc, 1)) : null,
      })],
    });
    const e = new ServerEditor({ extensions: [movesCaret, StarterKit], content: { type: "doc", content: [p("one")] } });
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, e.getState().schema.nodes.heading, { level: 1 }));
    firstToParagraph(e);
    expect(blocks(e)).toEqual(["paragraph:one"]);
  });

  it("keeps the marks waiting for the next typing when it adds its paragraph", () => {
    const e = editor(p("one"));
    const { schema } = e.getState();
    const bold = schema.mark("bold");
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, schema.nodes.heading, { level: 1 }).setStoredMarks([bold]));
    expect(blocks(e)).toEqual(["heading:one", "paragraph:"]);
    expect(e.getState().storedMarks).toEqual([bold]);
  });

  it("keeps the marks waiting for the next typing when it takes its paragraph away", () => {
    const e = editor(p("one"));
    const { schema } = e.getState();
    const bold = schema.mark("bold");
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    e.applyTransaction(e.getState().tr.setNodeMarkup(0, schema.nodes.paragraph).setStoredMarks([bold]));
    expect(blocks(e)).toEqual(["paragraph:one"]);
    expect(e.getState().storedMarks).toEqual([bold]);
  });

  it("gives back a line it did not add when everything is undone", () => {
    const e = editor(p("one"), p());
    caretAt(e, 2);
    e.commands.setHeading({ level: 1 });
    edit(e, tr => tr);
    caretAt(e, lastLinePos(e) + 1);
    e.commands.setHeading({ level: 2 });
    e.commands.undo();
    e.commands.undo();
    expect(blocks(e)).toEqual(["paragraph:one", "paragraph:"]);
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
