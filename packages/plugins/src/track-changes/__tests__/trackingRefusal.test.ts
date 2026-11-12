import { describe, it, expect } from "vitest";
import { EditorState, Plugin, DocAttrStep, findWrapping, Fragment, ReplaceStep, Slice, Step, StepMap, StepResult } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { COLLAB_SYNC_META } from "@scrivr/core";
import { doc, li, p, TestEditor, ul } from "./helpers";
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
 * The question is answered before anything runs: on step kinds, and on whether
 * a later step that writes across the gesture's own insertion can be cut at its
 * edge. Whether every gesture tracking lets through is then recorded completely
 * is a separate matter, and not one this file speaks for.
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

  // A later step that writes both inside the gesture's own insertion and past it
  // is cut at the insertion's edge only when it is a replace step that deletes,
  // or writes inline text within one block, and both cut pieces still fit where
  // the cut falls in text. Each of these breaks one of those conditions, so the
  // whole gesture is stopped. No built-in command or agent edit builds them; only
  // a host's own transaction can. Positions after the first step are noted.
  const hello = () => doc(p("hello"), p("world"));
  it.each([
    // new 8–11, world 13–18: the cut at 12 falls between blocks
    ["a deletion from an inserted paragraph into the next one", hello, (s: EditorState) =>
      s.tr.insert(7, p("new")).delete(9, 15)],
    // heabcllo 1–9: the replacement carries paragraphs
    ["a replacement of text across the insertion's edge with paragraphs", hello, (s: EditorState) =>
      s.tr.insertText("abc", 3).replace(4, 8, new Slice(Fragment.from([p("X"), p("Y")]), 1, 1))],
    // helloabc 1–9, world 11–16: the replacement spans two blocks
    ["a replacement of text across the insertion's edge and into the next paragraph", hello, (s: EditorState) =>
      s.tr.insertText("abc", 6).replaceWith(7, 12, s.schema.text("Z"))],
    // A 8–9, B 11–12, world 14–19: a wrap is not a step that can be cut
    ["a wrap of an inserted paragraph and the next one into a list", hello, (s: EditorState) => {
      const tr = s.tr.insert(7, Fragment.from([p("A"), p("B")]));
      const range = tr.doc.resolve(11).blockRange(tr.doc.resolve(15));
      const wrapping = range && findWrapping(range, s.schema.nodes.bullet_list!);
      if (!range || !wrapping) throw new Error("cannot wrap B and world in a list");
      return tr.wrap(range, wrapping);
    }],
    // hello 1–6, mabcid in the list item 10–16, world 20–25: the deletion's ends
    // sit at a different depth from the insertion's edges, so the pieces don't fit
    ["a deletion from before a list, through text inserted in it, to after it",
      () => doc(p("hello"), ul(li("mid")), p("world")), (s: EditorState) =>
      s.tr.insertText("abc", 11).delete(3, 23)],
  ])("stops %s, and says the steps overlap", (_, start, gesture) => {
    const refused: TrackingRefusal[] = [];
    const state = EditorState.create({
      doc: start(),
      plugins: [trackChangesPlugin({ userID: "alice", onRefused: refusal => refused.push(refusal) })],
    });
    const next = state.apply(gesture(state));

    expect(next.doc.eq(state.doc)).toBe(true);
    expect(refused).toEqual([{ reason: "overlapping-steps" }]);
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
