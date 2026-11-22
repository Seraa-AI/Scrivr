import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { Fragment, Slice } from "@scrivr/core/pm";
import type { Node as PmNode } from "@scrivr/core/pm";
import { changeActs, findChanges, reviewChanges, TrackChanges, TrackChangesStatus } from "../index";

/**
 * What one step inserts is one act, however many pieces it takes: differently
 * formatted runs, a line break. The first piece names the act and every piece
 * carries it as `creationId`, so deciding any piece decides all of it, and no
 * piece fuses with a separate change beside it.
 */

const editorWith = (text: string) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
    ],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text }] }] },
  });

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const text = (editor: ServerEditor) => {
  const out: string[] = [];
  editor.getState().doc.forEach((node: PmNode) => out.push(node.textContent));
  return out;
};

/** "**foo** bar", as a paste of formatted text brings it. */
const boldThenPlain = (editor: ServerEditor) => {
  const { schema } = editor.getState();
  const bold = schema.marks.bold;
  if (!bold) throw new Error("StarterKit has no bold");
  return new Slice(Fragment.from([schema.text("foo", [bold.create()]), schema.text(" bar")]), 0, 0);
};

const insert = (editor: ServerEditor, at: number, slice: Slice) =>
  editor.applyTransaction(editor.getState().tr.replace(at, at, slice));

const decisions: Array<"accepted" | "rejected"> = ["accepted", "rejected"];

describe("one step's insertion", () => {
  it("is one act across differently formatted runs", () => {
    const editor = editorWith("Hello");
    insert(editor, 6, boldThenPlain(editor));

    expect(pending(editor).length).toBeGreaterThan(1);
    expect(changeActs(pending(editor))).toHaveLength(1);
  });

  for (const decision of decisions) {
    it(`is ${decision} whole from any of its pieces`, () => {
      const editor = editorWith("Hello");
      insert(editor, 6, boldThenPlain(editor));
      const last = pending(editor).at(-1);
      if (!last) throw new Error("the insertion recorded nothing");

      reviewChanges(editor, { accepted: decision === "accepted" ? [last.id] : [], rejected: decision === "rejected" ? [last.id] : [] });

      expect(pending(editor)).toEqual([]);
      expect(text(editor)).toEqual([decision === "accepted" ? "Hellofoo bar" : "Hello"]);
    });
  }

  it("is one act with a line break inside it", () => {
    const editor = editorWith("Hello");
    const { schema } = editor.getState();
    const hardBreak = schema.nodes.hardBreak;
    if (!hardBreak) throw new Error("StarterKit has no hardBreak");
    insert(editor, 6, new Slice(Fragment.from([schema.text("a"), hardBreak.create(), schema.text("b")]), 0, 0));

    expect(changeActs(pending(editor))).toHaveLength(1);
  });

  it("stays apart from the author's own pending text beside it", () => {
    const editor = editorWith("Hello");
    editor.applyTransaction(editor.getState().tr.insertText("x", 6));
    // "Hellox": the formatted insertion goes right after the pending "x".
    insert(editor, 7, boldThenPlain(editor));

    expect(changeActs(pending(editor))).toHaveLength(2);
    const pasted = pending(editor).at(-1);
    if (!pasted) throw new Error("the insertion recorded nothing");
    reviewChanges(editor, { accepted: [], rejected: [pasted.id] });
    expect(text(editor)).toEqual(["Hellox"]);
  });

  it("of a single run still joins the author's typing beside it", () => {
    const editor = editorWith("Hello");
    editor.applyTransaction(editor.getState().tr.insertText("x", 6));
    editor.applyTransaction(editor.getState().tr.insertText("y", 7));

    expect(pending(editor)).toHaveLength(1);
  });
});
