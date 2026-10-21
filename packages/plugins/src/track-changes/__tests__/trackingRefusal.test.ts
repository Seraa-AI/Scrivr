import { describe, it, expect } from "vitest";
import { EditorState, Plugin, DocAttrStep, Fragment, ReplaceStep, Slice, Step, StepMap, StepResult } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { doc, p, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../index";
import { trackChangesPlugin } from "../engine/trackChangesPlugin";
import { reportedTracking } from "../engine/transactionProcessing";
import type { TrackingResult } from "../index";

/**
 * Tracking refuses a whole gesture rather than recording part of one. What makes
 * a gesture refusable is whether the replay can represent every step that
 * carries content — never how many there are, and never a step that is not
 * content at all.
 *
 * The question is answered on step kinds, before anything runs. Whether every
 * gesture built from supported kinds is then recorded completely is a separate
 * matter, and not one this file speaks for.
 */

/** A step kind the engine has no tracker for. */
class ShoutStep extends Step {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }
  override apply(target: PMNode) {
    const shouted = target.textBetween(this.from, this.to).toUpperCase();
    return StepResult.fromReplace(
      target,
      this.from,
      this.to,
      new Slice(Fragment.from(target.type.schema.text(shouted)), 0, 0),
    );
  }
  override getMap() {
    return StepMap.empty;
  }
  override invert(doc: PMNode) {
    return new ReplaceStep(this.from, this.to, doc.slice(this.from, this.to));
  }
  override map() {
    return this;
  }
  override toJSON() {
    return { stepType: "shout", from: this.from, to: this.to };
  }
}

const tracking = (editor: TestEditor): TrackingResult | null =>
  trackChangesPluginKey.getState(editor.state)!.lastTracking;

const refusal = (editor: TestEditor) => {
  const result = tracking(editor);
  return result?.status === "refused" ? result : undefined;
};

describe("tracking refuses only what it cannot represent", () => {
  it("refuses a step kind the replay has no tracker for", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new ShoutStep(1, 6)));

    const result = refusal(editor);
    expect(result?.failure).toBe("unsupported-step");
    expect(result?.failure === "unsupported-step" ? result.stepType : undefined)
      .toBe("ShoutStep");
  });

  it("records nothing when it refuses, rather than part of the gesture", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new ShoutStep(1, 6)));

    expect(editor.pendingChanges).toEqual([]);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("does not refuse a doc-attribute write, which is not tracked content", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new DocAttrStep("anAttr", "v")));

    expect(refusal(editor)).toBeUndefined();
  });

  it("tracks the content of a gesture that also writes a doc attribute", () => {
    const editor = new TestEditor(doc(p("start")));
    const tr = editor.state.tr.insertText("!", 1);
    tr.step(new DocAttrStep("anAttr", "v"));
    editor.dispatch(tr);

    expect(editor.pendingChanges.length).toBeGreaterThan(0);
    expect(tracking(editor)?.status).toBe("ready");
    expect(tracking(editor)?.steps).toBe(1);
  });

  it("reports diagnostics on a gesture it tracked, without refusing it", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.insertAt(1, "x");
    const result = tracking(editor);

    expect(result?.steps).toBeGreaterThan(0);
    expect(result?.status === "ready" ? result.elapsedMs : undefined)
      .toBeGreaterThanOrEqual(0);
    expect(refusal(editor)).toBeUndefined();
  });
});


describe("a refusal describes the document it was made for", () => {
  it("stops reporting the refusal once the host undoes that edit", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new ShoutStep(1, 6)));
    expect(refusal(editor)).toBeDefined();

    editor.undo();

    expect(editor.text).toBe("start");
    expect(tracking(editor)).toBeNull();
  });
});

describe("a refusal outranks a sibling success", () => {
  const ready = { status: "ready", steps: 1, elapsedMs: 0 } as const;
  const refused = {
    status: "refused",
    failure: "unsupported-step",
    stepType: "ShoutStep",
    steps: 1,
  } as const;

  it("keeps a refusal already reported in this round", () => {
    expect(reportedTracking(refused, ready)).toBe(refused);
  });

  it("reports the latest result when none has refused", () => {
    expect(reportedTracking(ready, ready)).toBe(ready);
    expect(reportedTracking(undefined, refused)).toBe(refused);
  });
});


describe("tracking outcomes belong to one dispatch", () => {
  const build = () => EditorState.create({
    doc: doc(p("start")),
    plugins: [
      trackChangesPlugin({ userID: "alice" }),
      new Plugin({
        appendTransaction(trs, _old, state) {
          return trs.some(tr => tr.getMeta("append-edit"))
            ? state.tr.insertText("!", state.doc.content.size - 1)
            : null;
        },
      }),
    ],
  });

  it("keeps a refusal when a later append round succeeds", () => {
    const initial = build();
    const state = initial.apply(initial.tr.step(new ShoutStep(1, 6)).setMeta("append-edit", true));
    expect(state.doc.textContent).toBe("START!");
    expect(trackChangesPluginKey.getState(state)!.lastTracking).toMatchObject({ status: "refused", failure: "unsupported-step" });
    const next = state.apply(state.tr.insertText("?", 1));
    expect(trackChangesPluginKey.getState(next)!.lastTracking?.status).toBe("ready");
  });

  it("resets the accumulator even when the next root only carries metadata", () => {
    const initial = build();
    const state = initial.apply(initial.tr.step(new ShoutStep(1, 6)));
    const next = state.apply(state.tr.setMeta("append-edit", true));
    expect(trackChangesPluginKey.getState(next)!.lastTracking?.status).toBe("ready");
  });

  it("keeps outcomes isolated between editor states", () => {
    const initial = build();
    const refused = initial.apply(initial.tr.step(new ShoutStep(1, 6)).setMeta("append-edit", true));
    const ready = initial.apply(initial.tr.insertText("!", 1));
    expect(trackChangesPluginKey.getState(refused)!.lastTracking?.status).toBe("refused");
    expect(trackChangesPluginKey.getState(ready)!.lastTracking?.status).toBe("ready");
  });
});
