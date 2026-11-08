import { describe, it, expect } from "vitest";
import { EditorState, Plugin, DocAttrStep, Fragment, ReplaceStep, Slice, Step, StepMap, StepResult } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { COLLAB_SYNC_META } from "@scrivr/core";
import { doc, p, TestEditor } from "./helpers";
import { TrackChangesStatus, trackChangesPluginKey } from "../index";
import { trackChangesPlugin } from "../engine/trackChangesPlugin";
import { reportedTracking } from "../engine/transactionProcessing";
import type { TrackingRefusal, TrackingResult } from "../index";

/**
 * Tracking refuses a whole gesture rather than recording part of one, and stops
 * it before it applies: someone suggesting must not change the text directly.
 * What makes a gesture refusable is whether the replay can represent every step
 * that carries content — never how many there are, and never a step that is not
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

/** A tracked editor state that reports what it stops. */
const suggesting = (refused: TrackingRefusal[], status = TrackChangesStatus.enabled) => EditorState.create({
  doc: doc(p("start")),
  plugins: [trackChangesPlugin({ userID: "alice", initialStatus: status, onRefused: refusal => refused.push(refusal) })],
});

describe("an edit tracking cannot record is stopped, and the host is told why", () => {
  it("stops a step kind the replay has no tracker for", () => {
    const refused: TrackingRefusal[] = [];
    const state = suggesting(refused);
    const next = state.apply(state.tr.step(new ShoutStep(1, 6)));

    expect(next.doc.textContent).toBe("start");
    expect(refused).toEqual([{ reason: "unsupported-step", stepType: "ShoutStep" }]);
    expect(trackChangesPluginKey.getState(next)!.changeSet.pending).toEqual([]);
  });

  it("stops nothing while suggestions are off", () => {
    const refused: TrackingRefusal[] = [];
    const state = suggesting(refused, TrackChangesStatus.disabled);
    const next = state.apply(state.tr.step(new ShoutStep(1, 6)));

    expect(next.doc.textContent).toBe("START");
    expect(refused).toEqual([]);
  });

  it("stops nothing that arrives from a collaborator", () => {
    const refused: TrackingRefusal[] = [];
    const state = suggesting(refused);
    const next = state.apply(state.tr.step(new ShoutStep(1, 6)).setMeta("y-sync$", {}));

    expect(next.doc.textContent).toBe("START");
    expect(refused).toEqual([]);
  });

  it("records nothing of a collaborator's edit that Scrivr's own sync applies", () => {
    const refused: TrackingRefusal[] = [];
    const state = suggesting(refused);
    const next = state.apply(state.tr.insertText(" there", 6).setMeta(COLLAB_SYNC_META, true));

    expect(next.doc.textContent).toBe("start there");
    expect(trackChangesPluginKey.getState(next)!.changeSet.pending).toEqual([]);
  });

  it("stops what the same gesture's other plugins would have added too", () => {
    const refused: TrackingRefusal[] = [];
    const state = EditorState.create({
      doc: doc(p("start")),
      plugins: [
        trackChangesPlugin({ userID: "alice", onRefused: refusal => refused.push(refusal) }),
        new Plugin({
          appendTransaction: (trs, _old, current) => trs.some(tr => tr.getMeta("append-edit"))
            ? current.tr.insertText("!", current.doc.content.size - 1)
            : null,
        }),
      ],
    });
    const next = state.apply(state.tr.step(new ShoutStep(1, 6)).setMeta("append-edit", true));

    expect(next.doc.textContent).toBe("start");
    expect(refused).toHaveLength(1);
  });

  it("records an edit another plugin adds across the edge of an insertion, as it was let through", () => {
    const refused: TrackingRefusal[] = [];
    const typed = EditorState.create({
      doc: doc(p("hello world")),
      plugins: [
        new Plugin({
          appendTransaction: (trs, _old, current) => trs.some(tr => tr.getMeta("append-edit"))
            ? current.tr.insertText("abc", 8).delete(10, 13)
            : null,
        }),
        trackChangesPlugin({ userID: "alice", onRefused: refusal => refused.push(refusal) }),
      ],
    });
    // "Xhello abcworld": the deletion takes back its own "c" and proposes removing "wo".
    const next = typed.apply(typed.tr.insertText("X", 1).setMeta("append-edit", true));

    expect(refused).toEqual([]);
    expect(next.doc.textContent).toBe("Xhello abworld");
    const pending = trackChangesPluginKey.getState(next)!.changeSet.pending;
    expect(pending.some(change => change.dataTracked.operation === "delete")).toBe(true);
  });
});

describe("tracking refuses only what it cannot represent", () => {
  it("does not refuse a doc-attribute write, which is not tracked content", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.dispatch(editor.state.tr.step(new DocAttrStep("anAttr", "v")));

    expect(tracking(editor)?.status).not.toBe("refused");
  });

  it("tracks the content of a gesture that also writes a doc attribute", () => {
    const editor = new TestEditor(doc(p("start")));
    const tr = editor.state.tr.insertText("!", 1);
    tr.step(new DocAttrStep("anAttr", "v"));
    editor.dispatch(tr);

    expect(editor.pendingChanges.length).toBeGreaterThan(0);
    expect(tracking(editor)?.status).toBe("tracked");
    expect(tracking(editor)?.steps).toBe(1);
  });

  it("reports diagnostics on a gesture it tracked", () => {
    const editor = new TestEditor(doc(p("start")));
    editor.insertAt(1, "x");
    const result = tracking(editor);

    expect(result?.steps).toBeGreaterThan(0);
    expect(result?.status === "tracked" ? result.elapsedMs : undefined).toBeGreaterThanOrEqual(0);
  });
});

describe("a refusal outranks a sibling success", () => {
  const ready: TrackingResult = { status: "tracked", steps: 1, elapsedMs: 0 };
  const refused: TrackingResult = { status: "refused", reason: "unsupported-step", stepType: "ShoutStep", steps: 1 };

  it("keeps a refusal already reported in this round", () => {
    expect(reportedTracking(refused, ready)).toBe(refused);
  });

  it("reports the latest result when none has refused", () => {
    expect(reportedTracking(ready, ready)).toBe(ready);
    expect(reportedTracking(undefined, refused)).toBe(refused);
  });
});

describe("viewing snapshots", () => {
  it("keeps the document as it is", () => {
    const state = suggesting([], TrackChangesStatus.viewSnapshots);
    expect(state.apply(state.tr.insertText("x", 1)).doc.textContent).toBe("start");
  });

  it("still takes in a collaborator's edit", () => {
    const state = suggesting([], TrackChangesStatus.viewSnapshots);
    expect(state.apply(state.tr.insertText("x", 1).setMeta("y-sync$", {})).doc.textContent).toBe("xstart");
  });
});
