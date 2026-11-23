/**
 * Own work is the same author and the same suggestion. One agent writing two
 * suggestions — A, then B — never takes back, folds into, or decides the
 * other's changes: each host row keeps exactly the changes its suggestion
 * wrote. Changes with no operation id keep the author-only rule.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Transaction } from "@scrivr/core/pm";
import { applyDiffAsSuggestion, changeActs, findChanges, TrackChanges, TrackChangesStatus, trackAsSuggestion, type SuggestionIntent } from "../index";

const editorOf = (content: unknown[]) => new ServerEditor({
  extensions: [StarterKit, TrackChanges.configure({ userID: "human", initialStatus: TrackChangesStatus.disabled, canAcceptReject: true })],
  content: { type: "doc", content },
});
const para = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });
const as = (editor: ServerEditor, operationId: string, build: (tr: Transaction) => Transaction) => {
  const intent: SuggestionIntent = { authorID: "ai", operationId };
  editor.applyTransaction(trackAsSuggestion(build(editor.getState().tr), intent.authorID, { operationId }));
};
const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const ofOperation = (editor: ServerEditor, operationId: string) => pending(editor).filter((c) => c.dataTracked.operationId === operationId);
const at = (editor: ServerEditor, needle: string) => {
  let found = -1;
  editor.getState().doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(needle)) found = pos + node.text.indexOf(needle);
  });
  return found;
};

describe("two suggestions by one author", () => {
  it("an insertion beside A's replacement is B's own act, decided apart", () => {
    const editor = editorOf([para("p", "alpha beta")]);
    as(editor, "A", (tr) => tr.insertText("BETA", at(editor, "beta"), at(editor, "beta") + 4));
    as(editor, "B", (tr) => tr.insertText("!", at(editor, "BETA") + 4));

    const acts = changeActs(pending(editor));
    const actOf = (operationId: string) => acts.filter((act) => act.records.some((r) => r.dataTracked.operationId === operationId));
    expect(actOf("A")).toHaveLength(1);
    expect(actOf("A")[0]!.records.every((r) => r.dataTracked.operationId === "A")).toBe(true);

    editor.commands.setChangeStatuses("rejected", ofOperation(editor, "A").map((c) => c.id));
    expect(editor.getState().doc.textContent).toContain("!");
  });

  it("an edit inside a block A created is B's own, not folded into A's creation", () => {
    const editor = editorOf([para("p", "first")]);
    const block = editor.getState().schema.nodes["paragraph"]!.create({ nodeId: "n" }, editor.getState().schema.text("new block"));
    as(editor, "A", (tr) => tr.insert(editor.getState().doc.content.size, block));
    as(editor, "B", (tr) => tr.insertText("X", at(editor, "block")));

    const acts = changeActs(pending(editor));
    expect(acts.every((act) => new Set(act.records.map((r) => r.dataTracked.operationId)).size === 1)).toBe(true);
  });

  it("deleting A's pending insertion records B's deletion, and A's insertion stays", () => {
    const editor = editorOf([para("p", "alpha")]);
    as(editor, "A", (tr) => tr.insertText(" gamma", at(editor, "alpha") + 5));
    as(editor, "B", (tr) => tr.delete(at(editor, "gamma"), at(editor, "gamma") + 5));

    expect(ofOperation(editor, "A").map((c) => c.dataTracked.operation)).toContain("insert");
    expect(ofOperation(editor, "B").map((c) => c.dataTracked.operation)).toContain("delete");
  });

  it("a second lane suggestion on the block leaves the first one's changes A's", () => {
    const editor = editorOf([para("p", "teh cat sat on teh mat")]);
    const apply = (proposedText: string, operationId: string) =>
      applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { nodeId: "p", proposedText, authorID: "ai", operationId });
    apply("the cat sat on teh mat", "A");
    const firstA = ofOperation(editor, "A").map((c) => c.id).sort();
    apply("the cat sat on the mat", "B");

    expect(ofOperation(editor, "A").map((c) => c.id).sort()).toEqual(firstA);
    expect(ofOperation(editor, "B").length).toBeGreaterThan(0);
  });

  it("re-applying the same suggestion still replaces its own changes", () => {
    const editor = editorOf([para("p", "teh cat")]);
    const apply = (proposedText: string) =>
      applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { nodeId: "p", proposedText, authorID: "ai", operationId: "A" });
    apply("the cat");
    apply("thee cat");
    editor.commands.setChangeStatuses("accepted", pending(editor).map((c) => c.id));
    expect(editor.getState().doc.textContent).toBe("thee cat");
  });

  it("a formatting change by B over A's keeps A's", () => {
    const editor = editorOf([para("p", "hello world")]);
    const size = (value: number) => editor.getState().schema.marks["fontSize"]!.create({ size: value });
    as(editor, "A", (tr) => tr.addMark(1, 6, size(20)));
    as(editor, "B", (tr) => tr.addMark(1, 6, size(30)));

    expect(ofOperation(editor, "A").length).toBeGreaterThan(0);
  });

  it("formatting pieces of two suggestions that touch are two acts", () => {
    const editor = editorOf([para("p", "hello world")]);
    const bold = () => editor.getState().schema.marks["bold"]!.create();
    as(editor, "A", (tr) => tr.addMark(1, 4, bold()));
    as(editor, "B", (tr) => tr.addMark(4, 6, bold()));

    const acts = changeActs(pending(editor));
    expect(acts.every((act) => new Set(act.records.map((r) => r.dataTracked.operationId)).size === 1)).toBe(true);
    expect(acts.length).toBeGreaterThanOrEqual(2);
  });

  it("insertAsSuggestion stores the operation id it is given", () => {
    const editor = editorOf([para("p", "teh cat")]);
    editor.commands.insertAsSuggestion("the", 1, 4, "ai", "row-7");
    expect(pending(editor).length).toBeGreaterThan(0);
    expect(pending(editor).every((c) => c.dataTracked.operationId === "row-7")).toBe(true);
  });
});
