import { describe, it, expect } from "vitest";
import { DocAttrStep } from "@scrivr/core/pm";
import { doc, p, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../index";
import type { TrackingResult } from "../index";

/**
 * Tracking is all-or-nothing: a gesture is recorded in full, or refused in full
 * with a result the host can act on. What makes a gesture refusable is whether
 * the replay can represent every one of its steps — never how many there are.
 */

const tracking = (editor: TestEditor): TrackingResult | null =>
  trackChangesPluginKey.getState(editor.state)!.lastTracking;

const refusal = (editor: TestEditor) => {
  const result = tracking(editor);
  return result?.status === "refused" ? result : undefined;
};

describe("tracking refuses only what it cannot represent", () => {
  it("refuses a step kind the replay has no tracker for", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new DocAttrStep("anAttr", "v")));

    const result = refusal(editor);
    expect(result?.failure).toBe("unsupported-step");
    expect(result?.failure === "unsupported-step" ? result.stepType : undefined)
      .toBe("DocAttrStep");
  });

  it("records nothing when it refuses, rather than part of the gesture", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new DocAttrStep("anAttr", "v")));

    expect(editor.pendingChanges).toEqual([]);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("reports diagnostics on a gesture it tracked, without refusing it", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.insertAt(1, "x");
    const result = tracking(editor);

    expect(result?.status).toBe("ready");
    expect(result?.steps).toBeGreaterThan(0);
    expect(result?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(refusal(editor)).toBeUndefined();
  });
});
