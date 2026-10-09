import { describe, it, expect } from "vitest";
import { AddMarkStep, AttrStep, RemoveMarkStep, ReplaceStep, Slice } from "@scrivr/core/pm";
import { doc, p, schema, TestEditor } from "./helpers";
import { stepRange } from "../engine/transactionProcessing";
import { trackChangesPluginKey } from "../index";

/**
 * Review answers for what it rewrote, so it has to know what that was. Most of
 * review's work is mark writing, and a mark step's position map is empty — ask
 * the map and a review that only moved marks looks like it touched nothing.
 */

const lastReview = (editor: TestEditor) =>
  trackChangesPluginKey.getState(editor.state)!.lastReview;

describe("a step's declared span", () => {
  it("covers mark steps, whose position maps are empty", () => {
    const mark = schema.marks.bold!.create();
    const add = new AddMarkStep(3, 9, mark);
    const remove = new RemoveMarkStep(3, 9, mark);

    for (const step of [add, remove]) {
      const mapped: number[] = [];
      step.getMap().forEach((...range) => mapped.push(...range));
      expect(mapped).toEqual([]); // nothing to learn from the map
      expect(stepRange(step)).toEqual({ from: 3, to: 9 });
    }
  });

  it("covers a node-attribute step as the position it addresses", () => {
    expect(stepRange(new AttrStep(4, "align", "center"))).toEqual({ from: 4, to: 4 });
  });

  it("covers a content step", () => {
    expect(stepRange(new ReplaceStep(2, 5, Slice.empty))).toEqual({ from: 2, to: 5 });
  });
});

describe("a mark-only review", () => {
  it("applies and leaves the document valid", () => {
    const editor = new TestEditor(doc(p("hello"), p("tail")));
    editor.insertAt(6, "!");

    editor.acceptChanges(editor.pendingChanges.map(c => c.id));

    expect(lastReview(editor)?.status).toBe("applied");
    expect(editor.text).toBe("hello!tail");
    expect(() => editor.state.doc.check()).not.toThrow();
  });
});
