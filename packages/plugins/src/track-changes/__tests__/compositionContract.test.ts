import { describe, it, expect } from "vitest";
import { doc, p, TestEditor } from "./helpers";
import { planChangeReview } from "../index";
import type { ReviewDependency, ReviewPlan } from "../index";

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
  // doc(p("new"), p("tail")): deleting 2..9 runs from inside the creation into
  // the paragraph after it, so one step writes records in both.
  const deleteAcross = (editor: TestEditor) => editor.deleteRange(2, 9);
  const deletionOfTail = (editor: TestEditor) =>
    editor.pendingChanges.find(c => c.dataTracked.operation === "delete" && editor.state.doc.textBetween(c.from, c.to) === "tai")!;

  it("does not fold the author's deletion outside the creation into it", () => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    deleteAcross(editor);
    const outside = deletionOfTail(editor);

    expect(outside.dataTracked.creationId).toBeUndefined();
    expect(planChangeReview(set(editor), { accepted: [id], rejected: [] }).accepted).not.toContain(outside.id);
    editor.acceptChanges([id]);
    expect(editor.pendingChanges.map(c => c.id)).toEqual([outside.id]);
    expect(editor.text).toBe("ntail");
  });

  it("makes only another author's deletion inside the creation depend on it", () => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.setUserID("bob");
    deleteAcross(editor);
    const outside = deletionOfTail(editor);

    expect(outside.dataTracked.dependsOn).toBeUndefined();
    const plan = planChangeReview(set(editor), { accepted: [], rejected: [id] });
    expect(dependenciesOf(plan).flatMap(d => d.dependentIds)).not.toContain(outside.id);
  });

  it.each(["accepted", "rejected"] as const)("folds the author's edits into the creation, then %s", decision => {
    const editor = insertParagraph();
    const id = creation(editor).id;
    editor.insertAt(4, "!");
    const plan = planChangeReview(set(editor), decision === "accepted" ? { accepted: [id], rejected: [] } : { accepted: [], rejected: [id] });
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
    const plan = planChangeReview(set(editor), { accepted: [], rejected: [id] });
    expect(plan.status).toBe("blocked");
    expect(dependenciesOf(plan)[0]!.relationship).toBe("existence");
    editor.rejectChanges([id]);
    expect(editor.state.doc).toBe(before);
    expect(set(editor).changes.map(c => c.dataTracked)).toEqual(snapshot);
    expect(trackChangesPluginKey.getState(editor.state)!.lastReview?.status).toBe("blocked");
    editor.rejectChanges([...plan.rejected, ...dependenciesOf(plan).flatMap(d => d.dependentIds)]);
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
    const plan = planChangeReview(set(editor), { accepted: [], rejected: [id] });
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

describe("one deletion recorded in several places", () => {
  // Deleting another author's pending paragraph keeps it as a proposal, so the
  // deletion is written on the node and again on the text inside it.
  const deleteTheirParagraph = () => {
    const editor = insertParagraph();
    const creationId = creation(editor).id;
    editor.setUserID("bob").deleteRange(0, 5);
    const deletion = editor.pendingChanges.find(c => c.type === "node-change" && c.dataTracked.authorID === "bob")!;
    return { editor, creationId, deletion: deletion.id };
  };

  it("does not report the deleting author's own records as dependent work", () => {
    const { editor, creationId, deletion } = deleteTheirParagraph();
    const bob = editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob").map(c => c.id);

    const plan = planChangeReview(set(editor), { accepted: [deletion], rejected: [] });

    const dependents = dependenciesOf(plan).flatMap(d => d.dependentIds);
    expect(dependents).toContain(creationId);
    expect(dependents.filter(id => bob.includes(id))).toEqual([]);
  });

  it("resolves the conflict by keeping the deletion", () => {
    const { editor, creationId, deletion } = deleteTheirParagraph();

    expect(planChangeReview(set(editor), { accepted: [deletion], rejected: [creationId] }).status).toBe("ready");
  });
});

describe("placement is transport, not a content snapshot", () => {
  it("closes creation folding when a separate placement depends on it", () => {
    const editor = moved();
    editor.dispatch(editor.state.tr.insert(0, p("new", { nodeId: "new" })));
    const id = creation(editor).id;
    move(editor, "new", "c", "after");
    expect(moves(editor)[0]!.dataTracked.dependsOn).toContain(id);
    expect(creation(editor).dataTracked.foldingClosed).toBe(true);
    expect(planChangeReview(set(editor), { accepted: [], rejected: [id] }).status).toBe("blocked");
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

  it("keeps a second author's edit made inside a move's shadow", () => {
    const editor = moved();
    move(editor, "a", "c", "after");
    editor.setUserID("bob").insertAt(2, "X");

    const bob = editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob");
    expect(bob.map(c => [c.type, c.dataTracked.operation])).toEqual([["text-change", "insert"]]);
  });

  it("names that edit before accepting the move takes the shadow away", () => {
    const editor = moved();
    move(editor, "a", "c", "after");
    editor.setUserID("bob").insertAt(2, "X");
    const placement = moves(editor)[0]!.id;
    const bob = editor.pendingChanges.filter(c => c.dataTracked.authorID === "bob").map(c => c.id);

    const plan = planChangeReview(set(editor), { accepted: [placement], rejected: [] });
    expect(plan.status).toBe("blocked");
    expect(dependenciesOf(plan).flatMap(d => d.dependentIds)).toEqual(bob);
    editor.acceptChanges([placement]);
    expect(editor.text).toBe("oXnetwothreeone");
    expect(editor.pendingChanges.map(c => c.id)).toEqual(expect.arrayContaining([placement, ...bob]));

    editor.acceptChanges([placement, ...bob]);
    expect(editor.text).toBe("twothreeone");
    expect(editor.pendingChanges).toEqual([]);
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
    const plan = planChangeReview(set(editor), { accepted: [], rejected: [first] });
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
