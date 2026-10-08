import { describe, expect, it } from "vitest";
import { closeHistory } from "@scrivr/core/pm";
import { doc, p, schema, TestEditor } from "./helpers";
import { canCancelInsertion } from "../lib/deletionPolicy";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";

it("preserves authorship through production editor commands and review", () => {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "tail" }, content: [{ type: "text", text: "tail" }] }] },
  });
  const changes = () => trackChangesPluginKey.getState(editor.getState())!.changeSet.changes;
  const paragraph = editor.schema.node("paragraph", { nodeId: "new" }, editor.schema.text("new"));
  editor.applyTransaction(editor.getState().tr.insert(0, paragraph));
  const alice = changes().map(change => change.id).sort();
  editor.commands.setTrackChangesUserID("bob");
  editor.applyTransaction(editor.getState().tr.delete(0, paragraph.nodeSize));
  const bob = changes().filter(change => change.dataTracked.authorID === "bob").map(change => change.id);
  expect(bob.length).toBeGreaterThan(0);
  editor.commands.setChangeStatuses("rejected", bob);
  expect(changes().map(change => change.id).sort()).toEqual(alice);
  expect(editor.getState().doc.textContent).toBe("newtail");
  expect(() => editor.getState().doc.check()).not.toThrow();
  editor.destroy();
});

const idsBy = (editor: TestEditor, authorID: string) => editor.pendingChanges
  .filter(change => change.dataTracked.authorID === authorID).map(change => change.id).sort();

describe("deletion ownership across write and review", () => {
  for (const wholeNode of [false, true]) {
    const create = () => {
      const editor = new TestEditor(doc(p("tail")), "alice");
      if (wholeNode) editor.dispatch(editor.state.tr.insert(0, p("new")));
      else editor.insertAt(1, "new");
      return editor;
    };
    const remove = (editor: TestEditor) => editor.deleteRange(wholeNode ? 0 : 1, wholeNode ? 5 : 4);

    it(`cancels one's own pending ${wholeNode ? "node" : "text"} insertion`, () => {
      const editor = create();
      remove(editor);
      expect(editor.text).toBe("tail");
      expect(editor.pendingChanges).toEqual([]);
      expect(() => editor.state.doc.check()).not.toThrow();
    });

    it(`preserves another author's ${wholeNode ? "node" : "text"} insertion when deletion is rejected`, () => {
      const editor = create();
      const alice = idsBy(editor, "alice");
      expect(alice.length).toBeGreaterThan(0);
      editor.setUserID("bob");
      remove(editor);
      expect(editor.text).toBe("newtail");
      expect(idsBy(editor, "alice")).toEqual(alice);
      const bob = idsBy(editor, "bob");
      expect(bob.length).toBeGreaterThan(0);
      editor.rejectChanges(bob);
      expect(editor.text).toBe("newtail");
      expect(idsBy(editor, "alice")).toEqual(alice);
      expect(idsBy(editor, "bob")).toEqual([]);
    });

    it(`accepting the ${wholeNode ? "node" : "text"} insertion preserves the other author's deletion`, () => {
      const editor = create();
      const alice = idsBy(editor, "alice");
      editor.setUserID("bob");
      remove(editor);
      const bob = idsBy(editor, "bob");
      editor.acceptChanges(alice);
      expect(editor.text).toBe("newtail");
      expect(idsBy(editor, "bob")).toEqual(bob);
      expect(idsBy(editor, "alice")).toEqual([]);
      editor.acceptChanges(bob);
      expect(editor.text).toBe("tail");
      expect(editor.pendingChanges).toEqual([]);
    });

    it(`undo/redo preserves both authors' ${wholeNode ? "node" : "text"} records`, () => {
      const editor = create();
      const before = editor.state.doc;
      editor.setUserID("bob");
      editor.dispatch(closeHistory(editor.state.tr));
      remove(editor);
      const after = editor.state.doc;
      editor.undo();
      expect(editor.state.doc.eq(before)).toBe(true);
      editor.redo();
      expect(editor.state.doc.eq(after)).toBe(true);
    });
  }

  it("preserves a collaborator's edit inside one's own inserted paragraph", () => {
    const editor = new TestEditor(doc(p("tail")), "alice");
    editor.dispatch(editor.state.tr.insert(0, p("new")));
    editor.setUserID("bob").insertAt(4, "!");
    const bob = idsBy(editor, "bob");
    const original = editor.pendingChanges.map(change => change.id).sort();
    editor.setUserID("alice").deleteRange(0, 6);
    expect(editor.text).toBe("new!tail");
    expect(idsBy(editor, "bob")).toEqual(bob);
    expect(editor.pendingChanges.some(change => change.dataTracked.authorID === "alice" && change.dataTracked.operation === "delete")).toBe(true);
    editor.rejectChanges(editor.pendingChanges.filter(change => change.dataTracked.operation === "delete").map(change => change.id));
    expect(editor.pendingChanges.map(change => change.id).sort()).toEqual(original);
    expect(editor.text).toBe("new!tail");
  });

  it("retains a nested insertion when another author deletes its container", () => {
    const editor = new TestEditor(doc(p("tail")), "alice");
    const list = schema.node("bullet_list", null, [
      schema.node("list_item", null, p("one")),
      schema.node("list_item", null, p("two")),
    ]);
    editor.dispatch(editor.state.tr.insert(0, list));
    const alice = idsBy(editor, "alice");
    editor.setUserID("bob").deleteRange(0, list.nodeSize);
    expect(editor.text).toBe("onetwotail");
    expect(idsBy(editor, "alice")).toEqual(alice);
    editor.rejectChanges(idsBy(editor, "bob"));
    expect(idsBy(editor, "alice")).toEqual(alice);
    expect(editor.state.doc.firstChild!.type.name).toBe("bullet_list");
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("cancels a nested insertion once without replaying deleted descendants", () => {
    const editor = new TestEditor(doc(p("tail")), "alice");
    const list = schema.node("bullet_list", null, [
      schema.node("list_item", null, p("one")),
      schema.node("list_item", null, p("two")),
    ]);
    editor.dispatch(editor.state.tr.insert(0, list));
    editor.deleteRange(0, list.nodeSize);
    expect(editor.text).toBe("tail");
    expect(editor.pendingChanges).toEqual([]);
    expect(() => editor.state.doc.check()).not.toThrow();
  });
});

describe("cancellation policy", () => {
  it("does not confuse inserting formatting with inserting the text", () => {
    const editor = new TestEditor(doc(p("original")), "alice");
    editor.dispatch(editor.state.tr.addMark(1, 9, schema.marks.bold!.create()));
    expect(editor.pendingChanges.some(change => change.type === "mark-change")).toBe(true);
    editor.deleteRange(1, 9);
    expect(editor.text).toBe("original");
    expect(editor.pendingChanges.some(change => change.dataTracked.operation === "delete")).toBe(true);
  });
  it("does not depend on the ordering of stacked authors' insertion marks", () => {
    const alice = schema.marks.trackedInsert!.create({ dataTracked: { authorID: "alice", operation: "insert", status: "pending" } });
    const bob = schema.marks.trackedInsert!.create({ dataTracked: { authorID: "bob", operation: "insert", status: "pending" } });
    for (const marks of [[alice, bob], [bob, alice]]) {
      expect(canCancelInsertion(schema.text("shared", marks), "alice")).toBe(false);
      expect(canCancelInsertion(schema.text("shared", marks), "bob")).toBe(false);
    }
  });

  it("does not treat accepted insertion records as a cancellable proposal", () => {
    const mark = schema.marks.trackedInsert!.create({ dataTracked: { authorID: "alice", operation: "insert", status: "accepted" } });
    expect(canCancelInsertion(schema.text("accepted", [mark]), "alice")).toBe(false);
  });
});
