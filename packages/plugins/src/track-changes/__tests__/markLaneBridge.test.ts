import { describe, it, expect } from "vitest";
import { doc, p, schema, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../index";

/**
 * Every tracker writes in the replayed document's frame. A gesture mixing a
 * position-shifting step with a mark step stamps the mark over the text the
 * gesture formatted, with a record behind all of it, so no formatting ends up
 * out of a reviewer's reach.
 */

const marked = (editor: TestEditor) => {
  const runs: Array<{ text: string; tracked: boolean }> = [];
  editor.state.doc.descendants(node => {
    if (!node.isText) return true;
    const bold = node.marks.find(m => m.type === schema.marks.bold);
    if (bold) {
      const records = bold.attrs.dataTracked;
      runs.push({ text: node.text ?? "", tracked: Array.isArray(records) && records.length > 0 });
    }
    return true;
  });
  return runs;
};

const boldThenInsert = () => {
  const editor = new TestEditor(doc(p("hello world")));
  const tr = editor.state.tr;
  tr.addMark(7, 12, schema.marks.bold!.create());
  tr.insertText("XX", 1);
  editor.dispatch(tr);
  return editor;
};

describe("trackers write through the replay bridge", () => {
  it("stamps the mark over the text the gesture formatted", () => {
    expect(marked(boldThenInsert()).map(run => run.text)).toEqual(["world"]);
  });

  it("leaves no formatting without a record behind it", () => {
    expect(marked(boldThenInsert()).filter(run => !run.tracked)).toEqual([]);
  });

  it("rejecting the formatting removes it from the text it was on", () => {
    const editor = boldThenInsert();
    const formatting = editor.pendingChanges.filter(c => c.type === "mark-change").map(c => c.id);
    expect(formatting).toHaveLength(1);
    editor.rejectChanges(formatting);
    expect(marked(editor)).toEqual([]);
  });

  it("records removing formatting over the text it came off", () => {
    const start = doc(p("hello world"));
    const editor = new TestEditor(start);
    const bold = schema.marks.bold!.create();
    const setup = editor.state.tr.addMark(7, 12, bold);
    editor.dispatch(setup);
    editor.acceptChanges(editor.pendingChanges.map(c => c.id));
    const tr = editor.state.tr.removeMark(7, 12, schema.marks.bold!);
    tr.insertText("XX", 1);
    editor.dispatch(tr);
    expect(marked(editor).map(run => run.text)).toEqual(["world"]);
    expect(editor.pendingChanges.some(c => c.type === "mark-change" && c.dataTracked.operation === "delete")).toBe(true);
  });

  it("records an attribute change on the block the gesture changed", () => {
    const editor = new TestEditor(doc(p("first"), p("second", { nodeId: "b" })));
    const tr = editor.state.tr.setNodeAttribute(7, "align", "center");
    tr.insert(0, p("top"));
    editor.dispatch(tr);
    expect(editor.state.doc.child(2).attrs.align).toBe("center");
    const change = editor.pendingChanges.find(c => c.type === "node-attr-change");
    expect(change?.from).toBe(editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize);
  });

  it("records a block-type change on the block the gesture changed", () => {
    const editor = new TestEditor(doc(p("first"), p("second")));
    const tr = editor.state.tr.setNodeMarkup(7, schema.nodes.heading, { level: 2 });
    tr.insertText("XX", 1);
    editor.dispatch(tr);
    expect(editor.state.doc.child(1).type.name).toBe("heading");
    expect(editor.pendingChanges.some(c => c.type === "node-attr-change" && c.from === editor.state.doc.child(0).nodeSize)).toBe(true);
  });

  it("reports a mixed gesture as tracked, and now it is", () => {
    const editor = boldThenInsert();
    expect(trackChangesPluginKey.getState(editor.state)!.lastTracking?.status).toBe("tracked");
    expect(marked(editor).every(run => run.tracked)).toBe(true);
  });
});
