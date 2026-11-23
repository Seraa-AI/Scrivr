/**
 * The engine repairs records a stored or converted document carries without
 * their bookkeeping on the next edit. The repair touches only the record it
 * repairs: never another record on the same block or mark, and every record
 * it can stamp ends stamped, so it does not run again on every edit.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { findChanges } from "../findChanges";

const editorAs = (userID: string, content: unknown[]) => new ServerEditor({
  extensions: [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
  content: { type: "doc", content },
});
/** Every createdAt and updatedAt left out. */
const withoutTimestamps = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "createdAt" && key !== "updatedAt").map(([key, v]) => [key, withoutTimestamps(v)]));
};
const stored = (editor: ServerEditor): unknown[] => {
  const content = withoutTimestamps(editor.getState().doc.toJSON().content);
  return Array.isArray(content) ? content : [];
};
const editAtEnd = (editor: ServerEditor) =>
  editor.applyTransaction(editor.getState().tr.insertText("x", editor.getState().doc.content.size - 1));

describe("repairing stored records", () => {
  it("drops a block record with no operation, and keeps the block's other records", () => {
    const valid = { id: "n1", authorID: "alice", operation: "insert", status: "pending", createdAt: 1, updatedAt: 1, statusUpdateAt: 0, reviewedByID: null };
    const broken = { id: "n2", authorID: "bob", status: "pending" };
    const editor = editorAs("carol", [
      { type: "paragraph", attrs: { nodeId: "a", dataTracked: [valid, broken] }, content: [{ type: "text", text: "inserted" }] },
      { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "tail" }] },
    ]);
    editAtEnd(editor);
    expect(findChanges(editor.getState()).pending.map((change) => change.id)).toContain("n1");
  });

  it("stamps two formatting records on one mark, each keeping its own id", () => {
    const record = (id: string, authorID: string) => ({ id, authorID, operation: "insert", status: "pending" });
    const editor = editorAs("carol", [
      { type: "paragraph", attrs: { nodeId: "a" }, content: [
        { type: "text", text: "bold", marks: [{ type: "bold", attrs: { dataTracked: [record("m1", "alice"), record("m2", "bob")] } }] },
        { type: "text", text: " tail" },
      ] },
    ]);
    editAtEnd(editor);
    const records = findChanges(editor.getState()).changes.filter((change) => change.id === "m1" || change.id === "m2");
    expect(records.map((change) => change.id).sort()).toEqual(["m1", "m2"]);
    expect(records.every((change) => typeof change.dataTracked.createdAt === "number")).toBe(true);
  });

  it("stamps a paragraph split's records, so it is not repaired on every edit", () => {
    const before = editorAs("alice", [{ type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "hello world" }] }]);
    before.applyTransaction(before.getState().tr.split(7));
    const editor = editorAs("carol", stored(before));
    expect(findChanges(editor.getState()).hasIncompleteAttrs).toBe(true);

    editAtEnd(editor);
    expect(findChanges(editor.getState()).hasIncompleteAttrs).toBe(false);
  });

  describe("records on one mark covering different text", () => {
    const stamped = { createdAt: 1, updatedAt: 1, statusUpdateAt: 0, reviewedByID: null };
    const record = (id: string, authorID: string, extra: Record<string, unknown> = {}) => ({ id, authorID, operation: "insert", status: "pending", ...extra });
    const bold = (text: string, records: unknown[]) => ({ type: "text", text, marks: [{ type: "bold", attrs: { dataTracked: records } }] });
    /** The ids of the bold records on each character of the first paragraph. */
    const boldIdsByChar = (editor: ServerEditor) => {
      const out: string[] = [];
      editor.getState().doc.child(0).forEach((node) => {
        const ids = (node.marks.find((m) => m.type.name === "bold")?.attrs["dataTracked"] ?? []).map((r: { id: string }) => r.id).sort().join("+");
        for (const _ of node.text ?? "") out.push(ids);
      });
      return out;
    };

    it("keeps another author's record on part of the text when one record is stamped", () => {
      const editor = editorAs("carol", [{ type: "paragraph", attrs: { nodeId: "a" }, content: [
        bold("a", [record("A", "alice")]),
        bold("b", [record("A", "alice"), record("B", "bob", stamped)]),
        bold("c", [record("A", "alice")]),
        { type: "text", text: " tail" },
      ] }]);
      editAtEnd(editor);
      expect(boldIdsByChar(editor).slice(0, 3)).toEqual(["A", "A+B", "A"]);
    });

    it("re-ids a record split around another, without spreading it over the gap", () => {
      const editor = editorAs("carol", [{ type: "paragraph", attrs: { nodeId: "a" }, content: [
        bold("a", [record("A", "alice"), record("B", "bob", stamped)]),
        bold("b", [record("B", "bob", stamped)]),
        bold("c", [record("A", "alice"), record("B", "bob", stamped)]),
        { type: "text", text: " tail" },
      ] }]);
      editAtEnd(editor);
      const [a, b, c] = boldIdsByChar(editor);
      expect(b).toBe("B");
      expect(a).toContain("B");
      expect(c).toContain("B");
      expect(a).not.toBe(c);
    });
  });

  it("does not store a conflict it only computed", () => {
    const pending = (id: string, authorID: string, operation: string) => ({ dataTracked: { id, authorID, operation, status: "pending" } });
    const editor = editorAs("carol", [{ type: "paragraph", attrs: { nodeId: "a" }, content: [
      { type: "text", text: "both", marks: [{ type: "trackedInsert", attrs: pending("i1", "alice", "insert") }, { type: "trackedDelete", attrs: pending("d1", "bob", "delete") }] },
      { type: "text", text: " tail" },
    ] }]);
    editAtEnd(editor);
    const stored: unknown[] = [];
    editor.getState().doc.descendants((node) => { for (const mark of node.marks) stored.push(mark.attrs["dataTracked"]); });
    expect(JSON.stringify(stored)).not.toContain("isConflict");
  });
});
