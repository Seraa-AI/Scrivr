/**
 * An agent changes a heading's level, makes a paragraph a heading, or makes a
 * heading a paragraph, through `attrs.level`. Each is a tracked change that a
 * reviewer accepts or rejects; rejecting restores the block as it was.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { applyRichDiffAsSuggestion, findChanges, TrackChanges, TrackChangesStatus } from "../index";

const editorWith = (block: Record<string, unknown>) =>
  new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ ...block, content: [{ type: "text", text: "Purpose" }] }] },
  });
const heading = (level: number) => ({ type: "heading", attrs: { nodeId: "b", level } });
const paragraph = { type: "paragraph", attrs: { nodeId: "b" } };

const setLevel = (editor: ServerEditor, level: unknown) =>
  applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
    edits: [{ nodeId: "b", attrs: { level } }],
    authorID: "agent",
  });
const block = (editor: ServerEditor) => {
  const node = editor.getState().doc.child(0);
  return node.type.name === "heading" ? `heading ${node.attrs.level}` : node.type.name;
};
const decide = (editor: ServerEditor, decision: "accepted" | "rejected") =>
  editor.commands.setChangeStatuses(decision, findChanges(editor.getState()).pending.map((change) => change.id));

describe("a block's heading level, set by an agent", () => {
  const cases = [
    { name: "a heading moves to another level", from: heading(2), level: 3, proposed: "heading 3", original: "heading 2" },
    { name: "a paragraph becomes a heading", from: paragraph, level: 2, proposed: "heading 2", original: "paragraph" },
    { name: "a heading becomes a paragraph at level 0", from: heading(2), level: 0, proposed: "paragraph", original: "heading 2" },
  ];

  it.each(cases)("$name, as one pending change", ({ from, level, proposed }) => {
    const editor = editorWith(from);
    expect(setLevel(editor, level)).toMatchObject({ applied: true, rejected: [] });

    expect(block(editor)).toBe(proposed);
    expect(findChanges(editor.getState()).pending).toHaveLength(1);
    expect(editor.getState().doc.child(0).attrs.nodeId).toBe("b");
  });

  it.each(cases)("$name: rejecting restores it", ({ from, level, original }) => {
    const editor = editorWith(from);
    setLevel(editor, level);
    decide(editor, "rejected");

    expect(block(editor)).toBe(original);
    expect(findChanges(editor.getState()).pending).toHaveLength(0);
  });

  it.each(cases)("$name: accepting keeps it", ({ from, level, proposed }) => {
    const editor = editorWith(from);
    setLevel(editor, level);
    decide(editor, "accepted");

    expect(block(editor)).toBe(proposed);
    expect(findChanges(editor.getState()).pending).toHaveLength(0);
  });

  it.each([9, -1, 2.5, "2"])("refuses level %s and changes nothing", (level) => {
    const editor = editorWith(heading(2));
    expect(setLevel(editor, level)).toMatchObject({ applied: false, rejected: ["b"] });
    expect(block(editor)).toBe("heading 2");
  });

  it("reports an edit that changes nothing as rejected", () => {
    const editor = editorWith(heading(2));
    expect(setLevel(editor, 2)).toMatchObject({ applied: false, rejected: ["b"] });
    expect(findChanges(editor.getState()).pending).toHaveLength(0);
  });
});

it("keeps a heading's level when an agent sets only its alignment", () => {
  const editor = editorWith(heading(2));
  setLevelless(editor);
  expect(block(editor)).toBe("heading 2");
  expect(editor.getState().doc.child(0).attrs.align).toBe("center");
});

function setLevelless(editor: ServerEditor) {
  applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
    edits: [{ nodeId: "b", attrs: { align: "center" } }],
    authorID: "agent",
  });
}
