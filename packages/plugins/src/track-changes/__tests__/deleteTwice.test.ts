import { describe, it, expect } from "vitest";
import { doc, p, TestEditor } from "./helpers";
import { CHANGE_OPERATION } from "../types";
import { planChangeReview } from "../index";
import { trackChangesPluginKey } from "../index";

/**
 * A node is either proposed for deletion or it is not. Deleting content that is
 * already a pending deletion proposes nothing new, so it must not stack a second
 * record — two identical records are each other's dependency, which leaves the
 * reviewer with twin cards that can never be resolved.
 */

const deletions = (editor: TestEditor) =>
  editor.pendingChanges.filter(
    c => c.type === "node-change" && c.dataTracked.operation === CHANGE_OPERATION.delete,
  );

const deleteFirstParagraph = (editor: TestEditor) => editor.deleteRange(0, 5);

const twice = (second?: string) => {
  const editor = new TestEditor(doc(p("one"), p("two")));
  deleteFirstParagraph(editor);
  if (second) editor.setUserID(second);
  deleteFirstParagraph(editor);
  return editor;
};

describe("deleting already-deleted content", () => {
  it("keeps one deletion record, not two", () => {
    expect(deletions(twice())).toHaveLength(1);
  });

  it("still keeps one when a second author deletes it", () => {
    expect(deletions(twice("bob"))).toHaveLength(1);
  });

  it("leaves the same change set as deleting it once", () => {
    const once = new TestEditor(doc(p("one"), p("two")));
    deleteFirstParagraph(once);

    const shape = (editor: TestEditor) =>
      editor.pendingChanges
        .map(c => `${c.type} ${c.dataTracked.operation} ${c.from}-${c.to}`)
        .sort();

    expect(shape(twice())).toEqual(shape(once));
  });

  it("leaves the deletion acceptable as one decision", () => {
    const editor = twice();
    const plan = planChangeReview(trackChangesPluginKey.getState(editor.state)!.changeSet, {
      accepted: editor.pendingChanges.map(c => c.id),
      rejected: [],
    });
    expect(plan.status).toBe("ready");

    editor.acceptChanges(editor.pendingChanges.map(c => c.id));
    expect(editor.text).toBe("two");
    expect(editor.pendingChanges).toEqual([]);
  });

  it("leaves the deletion rejectable", () => {
    const editor = twice();
    editor.rejectChanges(editor.pendingChanges.map(c => c.id));

    expect(editor.text).toBe("onetwo");
    expect(editor.pendingChanges).toEqual([]);
  });
});
