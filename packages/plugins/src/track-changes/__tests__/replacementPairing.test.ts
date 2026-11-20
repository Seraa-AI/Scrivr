import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { Fragment, Slice, TextSelection } from "@scrivr/core/pm";
import type { Node as PmNode } from "@scrivr/core/pm";
import { changeActs, findChanges, reviewChanges, TrackChanges, trackChangesPluginKey, TrackChangesStatus, type ReplacementView } from "../index";

/**
 * A replacement typed in suggesting mode is one act, as Google Docs shows it:
 * the words taken out and the words put in share a `groupId`, so one decision
 * covers both.
 */

const editorWith = (...texts: string[]) => editorIn("paired", ...texts);
const editorIn = (replacementView: ReplacementView, ...texts: string[]) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true, replacementView }),
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

/** Rejects the pending insertion that reads `text`, and with it the act it belongs to. */
const rejectInsertion = (editor: ServerEditor, text: string) => {
  const insertion = pending(editor).find(c => c.type === "text-change" && c.dataTracked.operation === "insert" && c.text === text);
  if (!insertion) throw new Error(`no pending insertion reads "${text}"`);
  reviewChanges(editor, { accepted: [], rejected: [insertion.id] });
};

const pendingTexts = (editor: ServerEditor) => pending(editor).map(c => (c.type === "text-change" ? c.text : c.type));
const groupIds = (editor: ServerEditor) => pending(editor).map(c => c.dataTracked.groupId);

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

  it("stays one act when the author corrects a typo inside it", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dgo");
    // "The dgo[cat] sat": "go" is 6–8.
    typeOver(editor, 6, 8, "og");

    expect(changeActs(pending(editor))).toHaveLength(1);
    rejectInsertion(editor, "dog");
    expect(pending(editor)).toEqual([]);
    expect(texts(editor)).toEqual(["The cat sat"]);
  });

  it("stays one act when the author retypes the whole word", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat": "dog" is taken back whole, and the new word continues its replacement.
    typeOver(editor, CAT.from, CAT.to, "cow");

    expect(changeActs(pending(editor))).toHaveLength(1);
    rejectInsertion(editor, "cow");
    expect(pending(editor)).toEqual([]);
    expect(texts(editor)).toEqual(["The cat sat"]);
  });

  it("joins it when the author types just before the replacement's text", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat": typed right before "dog".
    editor.applyTransaction(editor.getState().tr.insertText("x", CAT.from));

    expect(changeActs(pending(editor))).toHaveLength(1);
    rejectInsertion(editor, "xdog");
    expect(texts(editor)).toEqual(["The cat sat"]);
  });

  it("leaves an insertion made in the same transaction beside it as its own act", () => {
    const editor = editorWith("The cat sat");
    const tr = editor.getState().tr;
    tr.insertText("x", CAT.from);
    // "The xcat sat": "cat" is now 6–9.
    tr.insertText("dog", 6, 9);
    editor.applyTransaction(tr);

    expect(changeActs(pending(editor))).toHaveLength(2);
    rejectInsertion(editor, "dog");
    expect(pendingTexts(editor)).toEqual(["x"]);
  });

  it("leaves the author's earlier insertion beside it as its own act", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.insertText("big ", CAT.from));
    // "The big cat sat": "cat" is now 9–12, right after the pending "big ".
    typeOver(editor, 9, 12, "dog");

    expect(changeActs(pending(editor))).toHaveLength(2);
    rejectInsertion(editor, "dog");
    expect(texts(editor)).toEqual(["The big cat sat"]);
    expect(pendingTexts(editor)).toEqual(["big "]);
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

  it("keeps two replacements apart when the text between them is deleted", () => {
    const editor = editorWith("The cat sat on");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat on": "sat" is 12–15.
    typeOver(editor, 12, 15, "ran");
    // Take "ran" back, leaving "The dog[cat] [sat] on", then delete the space between.
    editor.applyTransaction(editor.getState().tr.delete(12, 15));
    editor.applyTransaction(editor.getState().tr.delete(11, 12));

    rejectInsertion(editor, "dog");
    expect(pendingTexts(editor).some(text => text.includes("cat"))).toBe(false);
    expect(pendingTexts(editor).some(text => text.includes("sat"))).toBe(true);
  });

  it("leaves a later deletion that comes to sit beside it as its own act", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat": strike the "s" (12–13), then the space between (11–12).
    editor.applyTransaction(editor.getState().tr.delete(12, 13));
    editor.applyTransaction(editor.getState().tr.delete(11, 12));

    rejectInsertion(editor, "dog");
    // The deletion of " s" is still pending on its own; "cat" is back.
    expect(texts(editor)).toEqual(["The cat sat"]);
    expect(pending(editor).map(c => c.dataTracked.operation)).toEqual(["delete"]);
    expect(pendingTexts(editor).every(text => text.includes("s") && !text.includes("cat"))).toBe(true);
  });
});

describe("edits that are not a replacement stay unpaired", () => {
  it("typing with nothing selected records an insertion without a groupId", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.insertText("big ", CAT.from));

    expect(groupIds(editor)).toEqual([undefined]);
  });

  it("deleting with nothing typed records a deletion without a groupId", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.delete(CAT.from, CAT.to));

    expect(groupIds(editor)).toEqual([undefined]);
  });

  it("typing over the author's own insertion takes it back and pairs nothing", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.insertText("big ", CAT.from));
    // "The big cat sat": the pending "big" is 5–8.
    typeOver(editor, 5, 8, "red");

    expect(pendingTexts(editor)).toEqual(["red "]);
    expect(groupIds(editor)).toEqual([undefined]);
  });

  it("typing over text already struck pairs nothing", () => {
    const editor = editorWith("The cat sat");
    editor.applyTransaction(editor.getState().tr.delete(CAT.from, CAT.to));
    typeOver(editor, CAT.from, CAT.to, "dog");

    expect(pending(editor).length).toBeGreaterThan(0);
    expect(groupIds(editor).every(id => id === undefined)).toBe(true);
  });

  it("pasting paragraphs over a word pairs nothing", () => {
    const editor = editorWith("The cat sat");
    const { schema } = editor.getState();
    const paragraph = schema.nodes.paragraph;
    if (!paragraph) throw new Error("StarterKit has no paragraph");
    const paragraphs = Fragment.from([paragraph.create(null, schema.text("x")), paragraph.create(null, schema.text("y"))]);
    editor.applyTransaction(editor.getState().tr.replace(CAT.from, CAT.to, new Slice(paragraphs, 1, 1)));

    expect(pending(editor).length).toBeGreaterThan(0);
    expect(groupIds(editor).every(id => id === undefined)).toBe(true);
  });

  it("moving text beside the author's replacement pairs nothing", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    // "The dog[cat] sat": move " sat" (11–15) to right after "dog" (8), in one transaction.
    const { schema } = editor.getState();
    const tr = editor.getState().tr.delete(11, 15);
    tr.insert(8, schema.text(" sat"));
    editor.applyTransaction(tr);

    const moved = pending(editor).filter(c => c.dataTracked.moveId !== undefined);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every(c => c.dataTracked.groupId === undefined)).toBe(true);
  });

  it("typing over a selection that spans two paragraphs pairs nothing", () => {
    const editor = editorWith("The cat sat", "on the mat");
    // From inside "cat" to inside "the" in the second paragraph.
    typeOver(editor, 6, 18, "x");

    expect(pending(editor).length).toBeGreaterThan(0);
    expect(groupIds(editor).every(id => id === undefined)).toBe(true);
  });
});

describe("the replacement view", () => {
  it("is one card by default", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The cat sat" }] }] },
    });
    typeOver(editor, CAT.from, CAT.to, "dog");

    expect(trackChangesPluginKey.getState(editor.getState())?.replacementView).toBe("paired");
    expect(changeActs(pending(editor))).toHaveLength(1);
  });

  it("split, shows the deletion and the insertion as Word does, each decided on its own", () => {
    const editor = editorIn("split", "The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");

    expect(changeActs(pending(editor), "split")).toHaveLength(2);
    rejectInsertion(editor, "dog");
    expect(texts(editor)).toEqual(["The cat sat"]);
    expect(pendingTexts(editor)).toEqual(["cat"]);
  });

  it("switches without rewriting the document", () => {
    const editor = editorWith("The cat sat");
    typeOver(editor, CAT.from, CAT.to, "dog");
    const before = editor.getState().doc;

    editor.commands.setReplacementView("split");
    expect(editor.getState().doc).toBe(before);
    expect(trackChangesPluginKey.getState(editor.getState())?.replacementView).toBe("split");
    rejectInsertion(editor, "dog");
    expect(pendingTexts(editor)).toEqual(["cat"]);

    editor.commands.setReplacementView("paired");
    expect(changeActs(pending(editor))).toHaveLength(1);
  });
});
