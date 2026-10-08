import { describe, it, expect } from "vitest";
import { doc, p, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { MAX_TRACKED_STEPS_PER_TR } from "../engine/transactionProcessing";

/**
 * A resource ceiling is knowable before the replay runs, so crossing it is a
 * refusal rather than a half-finished rewrite. The engine records nothing and
 * reports why; whether to undo the edit or warn is the host's decision, the
 * same division the review planner draws.
 */

const tracking = (editor: TestEditor) =>
  trackChangesPluginKey.getState(editor.state)!.lastTracking;

const refusal = (editor: TestEditor) => {
  const result = tracking(editor);
  return result?.status === "refused" ? result : undefined;
};

const manySteps = (count: number) => {
  const editor = new TestEditor(doc(p("start")));
  let tr = editor.state.tr;
  for (let i = 0; i < count; i++) tr = tr.insertText("x", 1);
  editor.dispatch(tr);
  return editor;
};

describe("tracking refuses a gesture it cannot record in full", () => {
  it("records no changes at all past the step ceiling", () => {
    const editor = manySteps(MAX_TRACKED_STEPS_PER_TR + 1);

    expect(editor.pendingChanges).toEqual([]);
    expect(refusal(editor)?.failure).toBe("step-budget-exceeded");
  });

  it("reports the step count and the ceiling it crossed", () => {
    const editor = manySteps(MAX_TRACKED_STEPS_PER_TR + 5);

    expect(refusal(editor)?.limit).toBe(MAX_TRACKED_STEPS_PER_TR);
    expect(refusal(editor)?.steps).toBeGreaterThan(MAX_TRACKED_STEPS_PER_TR);
  });

  it("leaves the document valid so the host can still undo the gesture", () => {
    const editor = manySteps(MAX_TRACKED_STEPS_PER_TR + 1);

    expect(() => editor.state.doc.check()).not.toThrow();
    editor.undo();
    expect(editor.text).toBe("start");
  });

  it("tracks a gesture that sits inside the ceiling, and reports ready", () => {
    const editor = manySteps(MAX_TRACKED_STEPS_PER_TR - 1);

    expect(editor.pendingChanges.length).toBeGreaterThan(0);
    expect(tracking(editor)?.status).toBe("ready");
    expect(refusal(editor)).toBeUndefined();
  });

  it("exempts a cut, which legitimately produces many steps", () => {
    const editor = new TestEditor(doc(p("start")));
    let tr = editor.state.tr.setMeta("uiEvent", "cut");
    for (let i = 0; i < MAX_TRACKED_STEPS_PER_TR + 1; i++) tr = tr.insertText("x", 1);
    editor.dispatch(tr);

    expect(refusal(editor)).toBeUndefined();
    expect(editor.pendingChanges.length).toBeGreaterThan(0);
  });
});
