import { describe, it, expect } from "vitest";
import { AddMarkStep, AttrStep, EditorState, Fragment, RemoveMarkStep, ReplaceStep, Schema, Slice } from "@scrivr/core/pm";
import { doc, p, schema, TestEditor } from "./helpers";
import { stepRange } from "../engine/transactionProcessing";
import { trackChangesPluginKey } from "../index";
import { checkReviewTransaction } from "../engine/checkReviewTransaction";

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

describe("review's write boundary", () => {
  const invalid = () => schema.nodes.unmarked_block!.create(null, schema.text("x", [schema.marks.bold!.create()]));

  it("checks all inserted content, even when longer than the replaced span", () => {
    const state = EditorState.create({ doc: doc(p("ok")) });
    const tr = state.tr.step(new ReplaceStep(0, 0, new Slice(Fragment.fromArray([p("valid"), invalid()]), 0, 0)));
    expect(() => checkReviewTransaction(tr)).toThrow();
  });

  const invalidAttributes = () => {
    const checked = new Schema({
      nodes: schema.spec.nodes,
      marks: schema.spec.marks.update("bold", { attrs: { weight: { default: 1, validate: "number" } } }),
    });
    const text = checked.text("x", [checked.marks.bold!.create({ weight: "invalid" })]);
    return checked.node("doc", null, checked.node("paragraph", null, text));
  };

  it("checks mark writes despite their empty position maps", () => {
    const state = EditorState.create({ doc: invalidAttributes() });
    const tr = state.tr;
    // A concrete mark step still addresses this content even if no such mark
    // is present. Invalid touched content must not pass the boundary.
    tr.step(new RemoveMarkStep(1, 2, state.schema.marks.trackedInsert!.create()));
    expect(() => checkReviewTransaction(tr)).toThrow();
  });

  it("checks attribute writes despite their empty position maps", () => {
    const state = EditorState.create({ doc: invalidAttributes() });
    const tr = state.tr.step(new AttrStep(0, "nodeId", "changed"));
    expect(() => checkReviewTransaction(tr)).toThrow();
  });

  it("maps each write through subsequent edits", () => {
    const state = EditorState.create({ doc: doc(p("ok"), invalid()) });
    const tr = state.tr.removeMark(1, 3, schema.marks.bold!);
    tr.step(new RemoveMarkStep(1, 3, schema.marks.bold!.create()));
    tr.insert(0, p("before"));
    expect(() => checkReviewTransaction(tr)).not.toThrow();
  });

  it("does not recursively check an untouched cousin in a shared container", () => {
    const invalidParagraph = schema.nodes.paragraph!.create(null, invalid());
    const list = schema.nodes.bullet_list!.create(null, [
      schema.nodes.list_item!.create(null, p("ok")),
      schema.nodes.list_item!.create(null, invalidParagraph),
    ]);
    const state = EditorState.create({ doc: doc(list) });
    const tr = state.tr.step(new RemoveMarkStep(3, 5, schema.marks.bold!.create()));
    expect(() => checkReviewTransaction(tr)).not.toThrow();
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
