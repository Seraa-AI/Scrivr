import { describe, it, expect } from "vitest";
import { doc, p, schema, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../index";

/**
 * A known defect, recorded so it cannot be mistaken for working behaviour.
 *
 * The replay keeps a bridge from the document a step applied to into the
 * replayed one, and advances it for every step. Only the replace tracker maps
 * through it: the mark, attribute and wrap trackers use raw positions. So a
 * gesture mixing a position-shifting step with a mark step stamps the mark in
 * the wrong place, and the tail of the run ends up formatted with an empty
 * record — formatting no reviewer can reach, because no change describes it.
 *
 * This matters to the promise that a gesture is tracked in full or not at all:
 * the preflight decides that on step kinds before anything runs, and these
 * steps are all kinds it supports, so it reports the gesture tracked while part
 * of the formatting goes unrecorded.
 *
 * `it.fails` is deliberate. When the trackers are fixed these flip to failing,
 * which is the signal to delete them.
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

describe("mark trackers ignore the replay bridge", () => {
  it.fails("stamps the mark over the text the gesture formatted", () => {
    const editor = boldThenInsert();
    expect(marked(editor).map(run => run.text)).toEqual(["world"]);
  });

  it.fails("leaves no formatting without a record behind it", () => {
    const editor = boldThenInsert();
    expect(marked(editor).filter(run => !run.tracked)).toEqual([]);
  });

  it("reports the gesture as tracked even so, which is what needs resolving", () => {
    const editor = boldThenInsert();
    const tracking = trackChangesPluginKey.getState(editor.state)!.lastTracking;

    expect(tracking?.status).toBe("ready");
    // The contradiction, stated: formatting with no record, under a ready report.
    expect(marked(editor).some(run => !run.tracked)).toBe(true);
  });
});
