import { describe, it, expect } from "vitest";
import { TextSelection } from "@scrivr/core/pm";
import { doc, p, schema, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";

/**
 * Being large is not a tracking failure. `addMark` emits a step per block, so a
 * document-wide formatting command produces one step per paragraph — thousands
 * on a real document — and every one of them has to be recorded and reviewable.
 */

const BLOCKS = 300;
/** Far above any step count a ceiling could plausibly have allowed. */
const MAX_PLAUSIBLE_CEILING = 100;

const tracking = (editor: TestEditor) =>
  trackChangesPluginKey.getState(editor.state)!.lastTracking;

/** Text nodes carrying the bold mark — zero if the command was never recorded. */
const bolded = (editor: TestEditor) => {
  let count = 0;
  editor.state.doc.descendants(node => {
    if (node.isText && node.marks.some(m => m.type === schema.marks.bold)) count++;
    return true;
  });
  return count;
};

const boldWholeDocument = () => {
  const editor = new TestEditor(
    doc(...Array.from({ length: BLOCKS }, (_, i) => p(`para ${i}`))),
  );
  const end = editor.state.doc.content.size;
  editor.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, end - 1)),
  );
  const tr = editor.state.tr.addMark(1, end - 1, schema.marks.bold!.create());
  const steps = tr.steps.length;
  editor.dispatch(tr);
  return { editor, steps };
};

describe("tracking a document-wide command", () => {
  it("records every block, at a step count far past any fixed ceiling", () => {
    const { editor, steps } = boldWholeDocument();

    expect(steps).toBeGreaterThan(MAX_PLAUSIBLE_CEILING);
    expect(tracking(editor)?.status).toBe("ready");
    expect(editor.pendingChanges.length).toBe(BLOCKS);
  });

  it("accepts the whole command, leaving every block bold", () => {
    const { editor } = boldWholeDocument();
    // The precondition is the fix: without it there is nothing to accept, and
    // the bold would already be sitting in the document unrecorded.
    expect(editor.pendingChanges.length).toBe(BLOCKS);
    editor.acceptChanges(editor.pendingChanges.map(c => c.id));

    expect(editor.pendingChanges).toEqual([]);
    expect(bolded(editor)).toBe(BLOCKS);
    expect(editor.text).toContain("para 0");
    expect(editor.text).toContain(`para ${BLOCKS - 1}`);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("rejects the whole command, leaving the text intact and unbold", () => {
    const { editor } = boldWholeDocument();
    expect(editor.pendingChanges.length).toBe(BLOCKS);
    editor.rejectChanges(editor.pendingChanges.map(c => c.id));

    expect(editor.pendingChanges).toEqual([]);
    expect(bolded(editor)).toBe(0);
    expect(editor.text).toContain(`para ${BLOCKS - 1}`);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("undoes the whole command in one step", () => {
    const { editor } = boldWholeDocument();
    expect(editor.pendingChanges.length).toBe(BLOCKS);
    expect(bolded(editor)).toBe(BLOCKS);

    editor.undo();

    expect(editor.pendingChanges).toEqual([]);
    expect(bolded(editor)).toBe(0);
    expect(editor.text).toContain(`para ${BLOCKS - 1}`);
  });
});
