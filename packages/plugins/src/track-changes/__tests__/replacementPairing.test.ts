import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import type { Node as PmNode } from "@scrivr/core/pm";
import { changeActs, findChanges, reviewChanges, TrackChanges, TrackChangesStatus } from "../index";

/**
 * A replacement typed in suggesting mode is one act, as in Word: the words
 * taken out and the words put in share a `groupId`, so one decision covers
 * both. Before, the two halves of one replace step got unrelated records and a
 * reviewer saw two cards for one word swap.
 */

const editorWith = (...texts: string[]) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
    ],
    content: {
      type: "doc",
      content: texts.map((text, i) => ({ type: "paragraph", attrs: { nodeId: `p${i}` }, content: [{ type: "text", text }] })),
    },
  });

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const texts = (editor: ServerEditor) => {
  const out: string[] = [];
  editor.getState().doc.forEach((node: PmNode) => out.push(node.textContent));
  return out;
};

/** Types `text` over `from`–`to`, as a keystroke over a selection does. */
const typeOver = (editor: ServerEditor, from: number, to: number, text: string) => {
  const tr = editor.getState().tr;
  tr.setSelection(TextSelection.create(tr.doc, from, to));
  editor.applyTransaction(tr.insertText(text));
};

const decisions: Array<"accepted" | "rejected"> = ["accepted", "rejected"];

// "The cat sat": "cat" is 5–8 inside the first paragraph.
const CAT = { from: 5, to: 8 };

describe("a word typed over a selection in suggesting mode", () => {
  it("is one act whose deletion and insertion share a groupId", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");

    const records = pending(editor);
    expect(records.map(c => c.dataTracked.operation).sort()).toEqual(["delete", "insert"]);
    const [first, second] = records;
    expect(first?.dataTracked.groupId).toBeDefined();
    expect(first?.dataTracked.groupId).toBe(second?.dataTracked.groupId);
    expect(changeActs(records)).toHaveLength(1);
  });

  for (const decision of decisions) {
    it(`is decided whole when only its insertion is ${decision}`, () => {
      const editor = editorWith("The cat sat");
      typeOver(editor, CAT.from, CAT.to, "dog");
      const insertion = pending(editor).find(c => c.dataTracked.operation === "insert");
      if (!insertion) throw new Error("typing over a selection recorded no insertion");

      reviewChanges(editor, { accepted: decision === "accepted" ? [insertion.id] : [], rejected: decision === "rejected" ? [insertion.id] : [] });

      expect(pending(editor)).toEqual([]);
      expect(texts(editor)).toEqual([decision === "accepted" ? "The dog sat" : "The cat sat"]);
    });
  }

  it("stays one act as the author keeps typing", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "d");
    editor.applyTransaction(editor.getState().tr.insertText("og", CAT.from + 1));

    // The typed text sits before the struck word it replaces.
    expect(texts(editor)).toEqual(["The dogcat sat"]);
    expect(changeActs(pending(editor))).toHaveLength(1);
  });

  it("keeps two replacements in one transaction as two acts", () => {
    const editor = editorWith("The cat sat");
    const tr = editor.getState().tr;
    tr.insertText("ran", 9, 12);
    tr.insertText("dog", CAT.from, CAT.to);
    editor.applyTransaction(tr);

    expect(changeActs(pending(editor))).toHaveLength(2);
  });

  it("stays paired when typed right after the author's own earlier insertion", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.insertText("big ", CAT.from));
    // "The big cat sat": "cat" is now 9–12, right after the pending "big ".
    typeOver(editor, 9, 12, "dog");

    const acts = changeActs(pending(editor));
    expect(acts).toHaveLength(1);
    expect(acts[0]?.records.map(c => c.dataTracked.operation).sort()).toEqual(["delete", "insert"]);
  });

  it("keeps a replacement made next to an earlier one as its own act", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat": " sat" starts right after the struck "cat".
    typeOver(editor, 11, 15, " ran");

    const acts = changeActs(pending(editor));
    expect(acts).toHaveLength(2);
    const textsOf = (act: (typeof acts)[number]) => act.records.map(c => (c.type === "text-change" ? c.text : "")).sort();
    expect(acts.map(textsOf)).toEqual(expect.arrayContaining([["cat", "dog"], [" ran", " sat"]]));
  });
});

describe("edits that are not a replacement stay unpaired", () => {
  it("typing with nothing selected records an insertion without a groupId", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.insertText("big ", CAT.from));

    expect(pending(editor).map(c => c.dataTracked.groupId)).toEqual([undefined]);
  });

  it("deleting with nothing typed records a deletion without a groupId", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.delete(CAT.from, CAT.to));

    expect(pending(editor).map(c => c.dataTracked.groupId)).toEqual([undefined]);
  });

  it("typing over a selection that spans two paragraphs pairs nothing", () => {
    const editor = editorWith("The cat sat", "on the mat");
    // From inside "cat" to inside "the" in the second paragraph.
    typeOver(editor, 6, 18, "x");

    expect(pending(editor).length).toBeGreaterThan(0);
    expect(pending(editor).every(c => c.dataTracked.groupId === undefined)).toBe(true);
  });
});
