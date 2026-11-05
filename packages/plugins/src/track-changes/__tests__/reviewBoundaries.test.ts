import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import type { Node as PmNode } from "@scrivr/core/pm";
import { changeActs, findChanges, planChangeReview, planReview, planReviewIn, reviewChanges, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "../index";
import type { ChangeAct, ReviewUnavailable, TrackChangesState, TrackingRefusal, TrackingResult } from "../index";

const paragraph = (nodeId: string, text: string) => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "text", text }],
});

const editorWith = (userID: string, content: Record<string, unknown>[]) =>
  new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
    ],
    content: { type: "doc", content },
  });

const handOver = (editor: ServerEditor, userID: string) =>
  editorWith(userID, editor.getState().doc.toJSON().content);

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;
const ids = (editor: ServerEditor) => pending(editor).map(c => c.id);
const lastTracking = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())?.lastTracking;
const texts = (editor: ServerEditor) => {
  const out: string[] = [];
  editor.getState().doc.forEach((node: PmNode) => out.push(node.textContent));
  return out;
};
const posOfBlock = (editor: ServerEditor, index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.getState().doc.child(i).nodeSize;
  return pos;
};

const pressEnter = (editor: ServerEditor, pos: number) =>
  editor.applyTransaction(editor.getState().tr.split(pos).setMeta("uiEvent", "Enter"));

const moveBlock = (editor: ServerEditor, index: number, before: number) => {
  const state = editor.getState();
  const node = state.doc.child(index);
  const from = posOfBlock(editor, index);
  const tr = state.tr.delete(from, from + node.nodeSize);
  editor.applyTransaction(tr.insert(tr.mapping.map(posOfBlock(editor, before)), node));
};

const pendingMoves = (editor: ServerEditor) =>
  pending(editor).filter(c => c.dataTracked.operation === "move").map(c => c.id);

describe("a gesture's later steps inside its own insertion", () => {
  const insertAndEdit = (edit: (tr: ReturnType<ServerEditor["getState"]>["tr"]) => void) => {
    const editor = editorWith("alice", [paragraph("a", "one")]);
    const state = editor.getState();
    const tr = state.tr.insert(5, state.schema.nodes.paragraph!.create({ nodeId: "n" }, state.schema.text("new0")));
    edit(tr);
    editor.applyTransaction(tr);
    return editor;
  };

  it("keeps text typed inside a block the same gesture inserted", () => {
    const editor = insertAndEdit(tr => tr.insertText("X", 8));
    expect(texts(editor)[1]).toBe("neXw0");
    expect(lastTracking(editor)?.status).toBe("tracked");
  });

  it("records the composed block as one insertion, so rejecting removes all of it", () => {
    const editor = insertAndEdit(tr => tr.insertText("X", 8));
    expect(changeActs(pending(editor))).toHaveLength(1);
    expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
    expect(texts(editor)).toEqual(["one"]);
  });

  it("accepts the composed block with the later text in it", () => {
    const editor = insertAndEdit(tr => tr.insertText("X", 8));
    expect(reviewChanges(editor, { accepted: ids(editor), rejected: [] }).status).toBe("applied");
    expect(texts(editor)).toEqual(["one", "neXw0"]);
    expect(pending(editor)).toEqual([]);
  });

  it("composes a deletion inside the insertion rather than proposing it", () => {
    const editor = insertAndEdit(tr => tr.delete(7, 9));
    expect(texts(editor)[1]).toBe("n0");
    expect(pending(editor).some(c => c.dataTracked.operation === "delete")).toBe(false);
  });

  it("carries formatting applied inside the insertion", () => {
    const editor = insertAndEdit(tr => tr.addMark(7, 9, tr.doc.type.schema.marks.bold!.create()));
    const inserted = editor.getState().doc.child(1);
    expect(inserted.textContent).toBe("new0");
    const bold: string[] = [];
    inserted.forEach(child => {
      if (child.marks.some(m => m.type.name === "bold")) bold.push(child.text ?? "");
    });
    expect(bold).toEqual(["ew"]);
  });

  it("composes steps that arrive nested inside one another", () => {
    const editor = insertAndEdit(tr => {
      tr.insertText("XY", 8);
      tr.insertText("Z", 9);
    });
    expect(texts(editor)[1]).toBe("neXZYw0");
  });

  it("leaves a step that only touches the insertion's edge as its own change", () => {
    const editor = editorWith("alice", [paragraph("a", "hello")]);
    const tr = editor.getState().tr.insertText("abc", 3);
    tr.insertText("Z", 6);
    editor.applyTransaction(tr);
    expect(texts(editor)).toEqual(["heabcZllo"]);
    expect(lastTracking(editor)?.status).toBe("tracked");
  });

  it("keeps the caret where the gesture left it inside the insertion", () => {
    const editor = editorWith("alice", [paragraph("a", "one")]);
    const state = editor.getState();
    const tr = state.tr.insert(5, state.schema.nodes.paragraph!.create({ nodeId: "n" }, state.schema.text("new0")));
    tr.insertText("X", 8);
    tr.setSelection(TextSelection.create(tr.doc, 9));
    editor.applyTransaction(tr);
    const after = editor.getState();
    expect(after.doc.textBetween(after.selection.from - 1, after.selection.from)).toBe("X");
  });

  it("refuses a step straddling the insertion's edge rather than misrecording it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = editorWith("alice", [paragraph("a", "hello world")]);
    const tr = editor.getState().tr.insertText("abc", 3);
    tr.delete(4, 8);
    const after = tr.doc.textContent;
    editor.applyTransaction(tr);
    expect(lastTracking(editor)).toMatchObject({ status: "refused", reason: "overlapping-steps" });
    expect(texts(editor)).toEqual([after]);
    expect(pending(editor)).toEqual([]);
    spy.mockRestore();
  });
});

describe("the caret after a multi-step gesture", () => {
  it("follows the steps replayed after it was placed", () => {
    const editor = editorWith("alice", [paragraph("a", "hello world")]);
    const tr = editor.getState().tr.delete(2, 5).insertText("ZZ", 6);
    tr.setSelection(TextSelection.create(tr.doc, 8));
    editor.applyTransaction(tr);
    const state = editor.getState();
    expect(state.doc.textBetween(state.selection.from - 2, state.selection.from)).toBe("ZZ");
  });
});

describe("a decision on two moves", () => {
  const twoMoves = () => {
    const editor = editorWith("u1", ["aaaa", "bbbb", "cccc", "dddd", "eeee"].map((t, i) => paragraph(`n${i}`, t)));
    moveBlock(editor, 3, 0);
    const first = pendingMoves(editor);
    moveBlock(editor, 1, 3);
    const second = pendingMoves(editor).filter(id => !first.includes(id));
    return { editor, first, second };
  };

  it("accepting the first and rejecting the second loses nothing", () => {
    const { editor, first, second } = twoMoves();
    expect(reviewChanges(editor, { accepted: first, rejected: second }).status).toBe("applied");
    expect(texts(editor)).toEqual(["dddd", "aaaa", "bbbb", "cccc", "eeee"]);
    expect(pending(editor)).toEqual([]);
  });

  it("rejecting the first and accepting the second loses nothing", () => {
    const { editor, first, second } = twoMoves();
    expect(reviewChanges(editor, { accepted: second, rejected: first }).status).toBe("applied");
    expect(texts(editor)).toEqual(["bbbb", "aaaa", "cccc", "dddd", "eeee"]);
    expect(pending(editor)).toEqual([]);
  });

  it("gives the same document as deciding them one at a time", () => {
    const together = twoMoves();
    reviewChanges(together.editor, { accepted: together.first, rejected: together.second });
    const apart = twoMoves();
    reviewChanges(apart.editor, { accepted: [], rejected: apart.second });
    reviewChanges(apart.editor, { accepted: apart.first, rejected: [] });
    expect(texts(together.editor)).toEqual(texts(apart.editor));
  });
});

describe("rejecting a paragraph break", () => {
  it("rejects everything typed after the break too", () => {
    const editor = editorWith("u1", [paragraph("a", "alpha beta")]);
    pressEnter(editor, 6);
    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("XY", state.doc.content.size - 1));
    expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
    expect(texts(editor)).toEqual(["alpha beta"]);
    expect(pending(editor)).toEqual([]);
  });

  it("restores two breaks whichever was made first", () => {
    for (const positions of [[5, 4], [4, 6]]) {
      const editor = editorWith("u1", [paragraph("a", "omega")]);
      for (const pos of positions) pressEnter(editor, pos!);
      expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
      expect(texts(editor)).toEqual(["omega"]);
      expect(pending(editor)).toEqual([]);
    }
  });

  it("keeps the other half's pending work when it is not decided", () => {
    const editor = editorWith("u1", [paragraph("a", "alpha beta")]);
    pressEnter(editor, 6);
    const breakRecords = ids(editor);
    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("XY", state.doc.content.size - 1));
    expect(reviewChanges(editor, { accepted: [], rejected: breakRecords }).status).toBe("applied");
    expect(texts(editor)).toEqual(["alpha betaXY"]);
    expect(pending(editor).map(c => c.dataTracked.operation)).toEqual(["insert"]);
  });

  it("decides the break from either of its records", () => {
    for (const operation of ["reference", "node_split"]) {
      for (const decision of ["accepted", "rejected"] as const) {
        const editor = editorWith("u1", [paragraph("a", "alpha beta")]);
        pressEnter(editor, 6);
        const record = pending(editor).find(c => c.dataTracked.operation === operation)!;
        const outcome = reviewChanges(editor, decision === "accepted"
          ? { accepted: [record.id], rejected: [] }
          : { accepted: [], rejected: [record.id] });
        expect(outcome.status).toBe("applied");
        expect(pending(editor)).toEqual([]);
        expect(texts(editor)).toEqual(decision === "accepted" ? ["alpha", " beta"] : ["alpha beta"]);
      }
    }
  });
});

describe("a decision on a formatting change below a block change", () => {
  it("rejects both, however far the block change shifted the text", () => {
    const editor = editorWith("u1", [paragraph("a", "first"), paragraph("b", "second")]);
    const state = editor.getState();
    editor.applyTransaction(state.tr.insert(0, state.schema.nodes.paragraph!.create({ nodeId: "t" }, state.schema.text("top"))));
    const next = editor.getState();
    const from = posOfBlock(editor, 2) + 1;
    editor.applyTransaction(next.tr.addMark(from, from + 6, next.schema.marks.bold!.create()));
    expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
    expect(texts(editor)).toEqual(["first", "second"]);
    expect(pending(editor)).toEqual([]);
  });
});

describe("one act, however many records it took", () => {
  const conflict = () => {
    const alice = editorWith("alice", [paragraph("x", "keep")]);
    const state = alice.getState();
    alice.applyTransaction(state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create({ nodeId: "n" }, state.schema.text("newtext"))));
    const bob = handOver(alice, "bob");
    const from = posOfBlock(bob, 1);
    bob.applyTransaction(bob.getState().tr.delete(from, from + bob.getState().doc.child(1).nodeSize));
    return bob;
  };

  it("groups a whole-paragraph conflict into its two authors' acts", () => {
    const acts = changeActs(pending(conflict()));
    expect(acts.map(act => act.primary.dataTracked.authorID).sort()).toEqual(["alice", "bob"]);
    expect(acts.every(act => act.records.length === 2)).toBe(true);
  });

  it("names the record others point at as the act's primary", () => {
    const editor = editorWith("u1", [paragraph("a", "alpha beta")]);
    pressEnter(editor, 6);
    const [act] = changeActs(pending(editor));
    expect(act!.primary.dataTracked.operation).toBe("node_split");
  });

  it("keeps the insertion as one decision", () => {
    const editor = conflict();
    const [keep, discard] = (() => {
      const acts = changeActs(pending(editor));
      return [acts.find(a => a.primary.dataTracked.authorID === "alice")!, acts.find(a => a.primary.dataTracked.authorID === "bob")!];
    })();
    expect(reviewChanges(editor, { accepted: [keep.primary.id], rejected: [discard.primary.id] }).status).toBe("applied");
    expect(texts(editor)).toEqual(["keep", "newtext"]);
    expect(pending(editor)).toEqual([]);
  });

  it("keeps the deletion as one decision", () => {
    const editor = conflict();
    const acts = changeActs(pending(editor));
    const alice = acts.find(a => a.primary.dataTracked.authorID === "alice")!;
    const bob = acts.find(a => a.primary.dataTracked.authorID === "bob")!;
    expect(reviewChanges(editor, { accepted: [bob.primary.id], rejected: [alice.primary.id] }).status).toBe("applied");
    expect(texts(editor)).toEqual(["keep"]);
    expect(pending(editor)).toEqual([]);
  });

  it("still calls one act decided both ways a contradiction", () => {
    const editor = conflict();
    const alice = changeActs(pending(editor)).find(a => a.primary.dataTracked.authorID === "alice")!;
    const [node, text] = alice.records;
    const plan = planChangeReview(findChanges(editor.getState()), { accepted: [node!.id], rejected: [text!.id] });
    expect(plan).toMatchObject({ status: "blocked", reason: "contradictory-decisions" });
  });

  it.each(["text-change", "node-change"] as const)("rejecting an inserted paragraph from its %s removes all of it", type => {
    const editor = editorWith("u1", [paragraph("a", "one")]);
    const state = editor.getState();
    editor.applyTransaction(state.tr.insert(5, state.schema.nodes.paragraph!.create({ nodeId: "n" }, state.schema.text("two"))));
    const record = pending(editor).find(c => c.type === type)!;
    expect(reviewChanges(editor, { accepted: [], rejected: [record.id] }).status).toBe("applied");
    expect(texts(editor)).toEqual(["one"]);
    expect(pending(editor)).toEqual([]);
  });

  it.each(["text-change", "node-change"] as const)("rejecting a deleted paragraph from its %s restores all of it", type => {
    const editor = editorWith("u1", [paragraph("a", "one"), paragraph("b", "two")]);
    const from = posOfBlock(editor, 1);
    editor.applyTransaction(editor.getState().tr.delete(from, from + 5));
    const record = pending(editor).find(c => c.type === type)!;
    expect(reviewChanges(editor, { accepted: [], rejected: [record.id] }).status).toBe("applied");
    expect(pending(editor)).toEqual([]);
    expect(texts(editor)).toEqual(["one", "two"]);
  });
});

describe("formatting across someone else's pending insertion", () => {
  const boldAcrossInsertion = () => {
    const alice = editorWith("alice", [paragraph("a", "gamma delta")]);
    alice.applyTransaction(alice.getState().tr.insertText("XY", 5));
    const bob = handOver(alice, "bob");
    const state = bob.getState();
    bob.applyTransaction(state.tr.addMark(6, 9, state.schema.marks.bold!.create()));
    return bob;
  };

  it("does not spread the insertion over the text beside it", () => {
    const inserted: string[] = [];
    boldAcrossInsertion().getState().doc.descendants(node => {
      if (node.isText && node.marks.some(m => m.type.name === "trackedInsert")) inserted.push(node.text ?? "");
    });
    expect(inserted.join("")).toBe("XY");
  });

  it("rejecting everything gives back the original words", () => {
    const editor = boldAcrossInsertion();
    expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
    expect(texts(editor)).toEqual(["gamma delta"]);
  });
});

describe("a deletion stacked partly on a pending insertion", () => {
  const stacked = () => {
    const alice = editorWith("alice", [paragraph("a", "gamma")]);
    alice.applyTransaction(alice.getState().tr.insertText("XY", 2));
    const bob = handOver(alice, "bob");
    bob.applyTransaction(bob.getState().tr.delete(2, 5));
    return bob;
  };

  it("rejecting everything settles the part the insertion did not take", () => {
    const editor = stacked();
    expect(reviewChanges(editor, { accepted: [], rejected: ids(editor) }).status).toBe("applied");
    expect(texts(editor)).toEqual(["gamma"]);
    expect(pending(editor)).toEqual([]);
  });

  it("accepting everything removes what was deleted", () => {
    const editor = stacked();
    expect(reviewChanges(editor, { accepted: ids(editor), rejected: [] }).status).toBe("applied");
    expect(texts(editor)).toEqual(["gmma"]);
    expect(pending(editor)).toEqual([]);
  });
});

describe("undoing a decision", () => {
  it("brings a whole conflict's decision back as one step", () => {
    const alice = editorWith("alice", [paragraph("x", "keep")]);
    const state = alice.getState();
    alice.applyTransaction(state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph!.create({ nodeId: "n" }, state.schema.text("new"))));
    const bob = handOver(alice, "bob");
    const from = posOfBlock(bob, 1);
    bob.applyTransaction(bob.getState().tr.delete(from, from + bob.getState().doc.child(1).nodeSize));
    const before = pending(bob).length;
    const acts = changeActs(pending(bob));
    const [keep, discard] = [acts[0]!, acts[1]!];
    expect(reviewChanges(bob, { accepted: [keep.primary.id], rejected: [discard.primary.id] }).status).toBe("applied");
    bob.commands.undo();
    expect(pending(bob)).toHaveLength(before);
  });
});

describe("the table's own normalization", () => {
  it("is not recorded as anyone's suggestion", () => {
    const cell = (nodeId: string, text: string) => ({ type: "tableCell", attrs: { nodeId }, content: [paragraph(`${nodeId}p`, text)] });
    const editor = new ServerEditor({
      extensions: [
        StarterKit.configure({ table: true }),
        TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }),
      ],
      content: {
        type: "doc",
        content: [{
          type: "table",
          attrs: { nodeId: "t" },
          content: [
            { type: "tableRow", attrs: { nodeId: "r1" }, content: [cell("a", "a"), cell("b", "b")] },
            { type: "tableRow", attrs: { nodeId: "r2" }, content: [cell("c", "c"), cell("d", "d")] },
          ],
        }, paragraph("z", "z")],
      },
    });
    const state = editor.getState();
    const firstCell = state.doc.child(0).child(0).child(0);
    editor.applyTransaction(state.tr.delete(2, 2 + firstCell.nodeSize));
    expect(pending(editor).filter(c => c.dataTracked.operation === "insert")).toEqual([]);
  });
});

describe("what a host writes down", () => {
  it("names the plugin state, the tracking outcome and the review answers", () => {
    const editor = editorWith("alice", [paragraph("a", "one")]);
    const state: TrackChangesState | undefined = trackChangesPluginKey.getState(editor.getState());
    const tracking: TrackingResult | null | undefined = state?.lastTracking;
    const refusal: TrackingRefusal = { reason: "overlapping-steps" };
    const acts: ChangeAct[] = changeActs(pending(editor));
    const absent: ReviewUnavailable | ReturnType<typeof planReview> = planReview(null, { accepted: [], rejected: [] });

    expect(tracking).toBeNull();
    expect(refusal.reason).toBe("overlapping-steps");
    expect(acts).toEqual([]);
    expect(absent).toEqual({ status: "unavailable", reason: "no-editor" });
    expect(planReviewIn(editor.getState(), { accepted: [], rejected: [] }).status).toBe("ready");
  });
});
