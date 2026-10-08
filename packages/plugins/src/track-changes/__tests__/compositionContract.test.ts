import { describe, it, expect } from "vitest";
import { doc, p, TestEditor } from "./helpers";
import { planChangeReview } from "../reviewPlan";
import type { ReviewDependency, ReviewPlan } from "../reviewPlan";

/** The dependencies a blocked plan reports, or none when it blocked for another reason. */
const dependenciesOf = (plan: ReviewPlan): ReviewDependency[] =>
  plan.status === "blocked" && plan.reason === "dependent-changes" ? plan.dependencies : [];
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";

const set = (editor: TestEditor) => trackChangesPluginKey.getState(editor.state)!.changeSet;
const creation = (editor: TestEditor) => editor.pendingChanges.find(c => c.type === "node-change" && c.dataTracked.operation === "insert")!;
const insertParagraph = () => {
  const editor = new TestEditor(doc(p("tail")), "alice");
  editor.dispatch(editor.state.tr.insert(0, p("new")));
  return editor;
};

describe("semantic composition", () => {
  it.each(["accepted", "rejected"] as const)("folds the author's edits into the creation, then %s", decision => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.insertAt(4, "!");
    const plan = planChangeReview(set(editor), decision, [id]);
    expect(plan.status).toBe("ready");
    if (decision === "accepted") editor.acceptChanges([id]);
    else editor.rejectChanges([id]);
    expect(editor.text).toBe(decision === "accepted" ? "new!tail" : "tail");
    expect(editor.pendingChanges).toEqual([]);
  });

  it("accepts the creation and rejects the independent edit", () => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.setUserID("bob").insertAt(4, "!");
    const bob = editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob").map(c => c.id);
    editor.acceptChanges([id]);
    expect(editor.pendingChanges.map(c => c.id)).toEqual(bob);
    editor.rejectChanges(bob);
    expect(editor.text).toBe("newtail");
    expect(editor.pendingChanges).toEqual([]);
  });

  it("requires an explicit compound rejection of creation and dependent work", () => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.setUserID("bob").insertAt(4, "!");
    const before = editor.state.doc;
    const snapshot = set(editor).changes.map(c => ({ ...c.dataTracked }));
    const plan = planChangeReview(set(editor), "rejected", [id]);
    expect(plan.status).toBe("blocked");
    expect(dependenciesOf(plan)[0]!.relationship).toBe("existence");
    editor.rejectChanges([id]);
    expect(editor.state.doc).toBe(before);
    expect(set(editor).changes.map(c => c.dataTracked)).toEqual(snapshot);
    expect(trackChangesPluginKey.getState(editor.state)!.lastReview?.status).toBe("blocked");
    editor.rejectChanges([...plan.ids, ...dependenciesOf(plan).flatMap(d => d.dependentIds)]);
    expect(editor.text).toBe("tail");
    expect(editor.pendingChanges).toEqual([]);
  });

  it("does not reopen folding after the other author's change is reviewed", () => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.setUserID("bob").insertAt(4, "!");
    editor.rejectChanges(editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob").map(c => c.id));
    expect(creation(editor).dataTracked.foldingClosed).toBe(true);
    editor.setUserID("alice").insertAt(4, "?");
    const plan = planChangeReview(set(editor), "rejected", [id]);
    expect(plan.status).toBe("blocked");
    expect(dependenciesOf(plan).flatMap(d => d.dependentIds)).toEqual(
      editor.pendingChanges.filter(c => c.dataTracked.dependsOn?.includes(id)).map(c => c.id),
    );
  });
});

function move(editor: TestEditor, id: string, anchorId: string, position: "before" | "after") {
  const blocks: Array<{ pos: number; node: typeof editor.state.doc }> = [];
  editor.state.doc.forEach((node, pos) => {
    if (!(node.attrs.dataTracked ?? []).some((record: { operation: string }) => record.operation === "delete")) blocks.push({ node, pos });
  });
  const source = blocks.find(block => block.node.attrs.nodeId === id)!;
  const anchor = blocks.find(block => block.node.attrs.nodeId === anchorId)!;
  const at = anchor.pos + (position === "after" ? anchor.node.nodeSize : 0);
  const tr = editor.state.tr.delete(source.pos, source.pos + source.node.nodeSize);
  tr.insert(at > source.pos ? at - source.node.nodeSize : at, source.node);
  editor.dispatch(tr);
}
const moved = () => new TestEditor(doc(p("one", { nodeId: "a" }), p("two", { nodeId: "b" }), p("three", { nodeId: "c" })), "alice");
const moves = (editor: TestEditor) => editor.pendingChanges.filter(change => change.dataTracked.operation === "move");

describe("placement is transport, not a content snapshot", () => {
  it("closes creation folding when a separate placement depends on it", () => {
    const editor = moved();
    editor.dispatch(editor.state.tr.insert(0, p("new", { nodeId: "new" })));
    const id = creation(editor).id;
    move(editor, "new", "c", "after");
    expect(moves(editor)[0]!.dataTracked.dependsOn).toContain(id);
    expect(creation(editor).dataTracked.foldingClosed).toBe(true);
    expect(planChangeReview(set(editor), "rejected", [id]).status).toBe("blocked");
    editor.rejectChanges([id, ...moves(editor).map(change => change.id)]);
    expect(editor.text).toBe("onetwothree");
    expect(editor.pendingChanges).toEqual([]);
  });
  it.each(["forward", "backward"] as const)("rejects a %s move while preserving Bob's subsequent edit and identity", direction => {
    const editor = moved();
    const id = direction === "forward" ? "a" : "c";
    move(editor, id, direction === "forward" ? "c" : "a", direction === "forward" ? "after" : "before");
    const placement = moves(editor)[0]!;
    editor.setUserID("bob").insertAt(placement.from + 1, "!");
    const bob = editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob").map(c => c.id);
    editor.rejectChanges([placement.id]);
    expect(editor.text).toBe(direction === "forward" ? "!onetwothree" : "onetwo!three");
    expect(editor.pendingChanges.map(c => c.id)).toEqual(bob);
    expect(() => editor.state.doc.check()).not.toThrow();
    editor.rejectChanges(bob);
    expect(editor.text).toBe("onetwothree");
  });

  it("moves existing pending inline work without duplicating its review identity", () => {
    const editor = moved();
    editor.setUserID("bob").insertAt(4, "!");
    const bob = editor.pendingChanges.map(c => c.id);
    editor.setUserID("alice");
    move(editor, "a", "c", "after");
    expect(set(editor).hasInconsistentData).toBe(false);
    const placement = moves(editor)[0]!;
    editor.rejectChanges([placement.id]);
    expect(editor.text).toBe("one!twothree");
    expect(editor.pendingChanges.map(c => c.id)).toEqual(bob);
  });

  it("keeps a second author's move as a placement dependency", () => {
    const editor = moved();
    move(editor, "a", "c", "after");
    const first = moves(editor)[0]!.id;
    editor.setUserID("bob");
    move(editor, "a", "b", "after");
    expect(moves(editor)).toHaveLength(2);
    const second = moves(editor).find(c => c.id !== first)!;
    expect(second.dataTracked.placementDependsOn).toEqual([first]);
    const plan = planChangeReview(set(editor), "rejected", [first]);
    expect(plan.status).toBe("blocked");
    expect(dependenciesOf(plan)).toContainEqual({ changeId: first, dependentIds: [second.id], relationship: "placement" });
    const before = editor.state.doc;
    editor.rejectChanges([first]);
    expect(editor.state.doc).toBe(before);
    editor.rejectChanges([second.id]);
    expect(moves(editor).map(c => c.id)).toEqual([first]);
    editor.rejectChanges([first]);
    expect(editor.text).toBe("onetwothree");
    expect(editor.pendingChanges).toEqual([]);
  });

  it.each(["accepted", "rejected"] as const)("resolves two explicitly selected moves in dependency order: %s", decision => {
    const editor = moved();
    move(editor, "a", "c", "after");
    editor.setUserID("bob");
    move(editor, "a", "b", "after");
    const ids = moves(editor).map(c => c.id);
    if (decision === "accepted") editor.acceptChanges(ids);
    else editor.rejectChanges(ids);
    expect(editor.text).toBe(decision === "accepted" ? "twoonethree" : "onetwothree");
    expect(editor.pendingChanges).toEqual([]);
  });
});
