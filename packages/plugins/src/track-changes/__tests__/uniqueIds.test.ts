/**
 * Block ids are unique at the source: a split's halves differ, while a pending
 * move's two copies keep the one id they share by design.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { redo, Slice, splitBlock, splitListItem, TextSelection, undo, type Node as PMNode } from "@scrivr/core/pm";
import { changeActs, reviewChanges, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";

type DocNode = Record<string, unknown>;
const para = (nodeId: string, text: string): DocNode => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });

function editorWith(content: DocNode[]) {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content },
  });
}

const topIds = (editor: ServerEditor) => {
  const ids: unknown[] = [];
  editor.getState().doc.forEach((node) => ids.push(node.attrs["nodeId"]));
  return ids;
};

const pendingActs = (editor: ServerEditor) => changeActs(trackChangesPluginKey.getState(editor.getState())?.changeSet.pending ?? []);

describe("a tracked split", () => {
  it("gives its second half a fresh id", () => {
    const editor = editorWith([para("p", "AlphaBeta")]);
    editor.applyTransaction(editor.getState().tr.split(6));
    const [first, second] = topIds(editor);
    expect(first).toBe("p");
    expect(second).not.toBe("p");
  });

  it("is accepted with both halves kept under their own ids", () => {
    const editor = editorWith([para("p", "AlphaBeta")]);
    editor.applyTransaction(editor.getState().tr.split(6));
    expect(reviewChanges(editor, { accepted: pendingActs(editor).map((a) => a.primary.id), rejected: [] }).status).toBe("applied");
    const ids = topIds(editor);
    expect(editor.getState().doc.textContent).toBe("AlphaBeta");
    expect(ids[0]).toBe("p");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is rejected back into one block that keeps the first half's id", () => {
    const editor = editorWith([para("p", "AlphaBeta")]);
    editor.applyTransaction(editor.getState().tr.split(6));
    expect(reviewChanges(editor, { accepted: [], rejected: pendingActs(editor).map((a) => a.primary.id) }).status).toBe("applied");
    expect(editor.getState().doc.child(0).textContent).toBe("AlphaBeta");
    expect(topIds(editor)[0]).toBe("p");
  });
});

describe("a tracked Enter at the start of a paragraph", () => {
  const atStart = () => {
    const editor = editorWith([para("p", "Hello")]);
    editor.applyTransaction(editor.getState().tr.split(1));
    return editor;
  };
  const idOfText = (editor: ServerEditor, text: string) => {
    let id: unknown;
    editor.getState().doc.forEach((node) => {
      if (node.textContent === text) id = node.attrs["nodeId"];
    });
    return id;
  };

  it("leaves the paragraph its id; the empty line before it is new", () => {
    const editor = atStart();
    expect(idOfText(editor, "Hello")).toBe("p");
    expect(new Set(topIds(editor)).size).toBe(2);
  });

  it("is accepted keeping the paragraph's id", () => {
    const editor = atStart();
    expect(reviewChanges(editor, { accepted: pendingActs(editor).map((a) => a.primary.id), rejected: [] }).status).toBe("applied");
    expect(idOfText(editor, "Hello")).toBe("p");
  });

  it("is rejected back into the one paragraph, under its id", () => {
    const editor = atStart();
    expect(reviewChanges(editor, { accepted: [], rejected: pendingActs(editor).map((a) => a.primary.id) }).status).toBe("applied");
    expect(editor.getState().doc.childCount).toBe(1);
    expect(idOfText(editor, "Hello")).toBe("p");
  });
});

describe("a rejected Enter gives the paragraph back the id it had", () => {
  const rejectAll = (editor: ServerEditor) =>
    reviewChanges(editor, { accepted: [], rejected: pendingActs(editor).map((a) => a.primary.id) }).status;
  const enterAt = (editor: ServerEditor, from: number, to = from) => {
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, from, to)));
    splitBlock(editor.getState(), (tr) => editor.applyTransaction(tr));
  };
  const onlyBlock = (editor: ServerEditor) => {
    const doc = editor.getState().doc;
    return { count: doc.childCount, text: doc.child(0).textContent, id: doc.child(0).attrs["nodeId"] };
  };

  it("after typing into the empty line Enter at its start opened", () => {
    const editor = editorWith([para("p", "Hello")]);
    enterAt(editor, 1);
    editor.applyTransaction(editor.getState().tr.insertText("New", 1));
    expect(rejectAll(editor)).toBe("applied");
    expect(onlyBlock(editor)).toEqual({ count: 1, text: "Hello", id: "p" });
  });

  it("after Enter replaced a selection at its start", () => {
    const editor = editorWith([para("p", "Hello")]);
    enterAt(editor, 1, 3);
    expect(rejectAll(editor)).toBe("applied");
    expect(onlyBlock(editor)).toEqual({ count: 1, text: "Hello", id: "p" });
  });

  it("after the words before the break, the author's own, were taken out again", () => {
    const editor = editorWith([para("p", "Hello")]);
    editor.applyTransaction(editor.getState().tr.insertText("AB", 1));
    enterAt(editor, 3);
    editor.applyTransaction(editor.getState().tr.delete(1, 3));
    expect(rejectAll(editor)).toBe("applied");
    expect(onlyBlock(editor)).toEqual({ count: 1, text: "Hello", id: "p" });
  });

  it.each([["StarterKit first", true], ["TrackChanges first", false]])("leaves the paragraph its id, %s", (_order, starterFirst) => {
    const tracking = TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true });
    const editor = new ServerEditor({
      extensions: starterFirst ? [StarterKit, tracking] : [tracking, StarterKit],
      content: { type: "doc", content: [para("p", "Hello")] },
    });
    enterAt(editor, 1);
    const ids: Array<[unknown, string]> = [];
    editor.getState().doc.forEach((node) => ids.push([node.attrs["nodeId"], node.textContent]));
    expect(ids.find(([, text]) => text === "Hello")?.[0]).toBe("p");
    expect(new Set(ids.map(([id]) => id)).size).toBe(ids.length);
  });

  it("whichever order the extensions are registered in", () => {
    const editor = new ServerEditor({
      extensions: [TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }), StarterKit],
      content: { type: "doc", content: [para("p", "Hello")] },
    });
    enterAt(editor, 1);
    expect(rejectAll(editor)).toBe("applied");
    expect(onlyBlock(editor)).toEqual({ count: 1, text: "Hello", id: "p" });
  });
});

describe("a tracked Enter in a list", () => {
  it("gives the new item and its paragraph ids of their own", () => {
    const editor = editorWith([{ type: "bulletList", attrs: { nodeId: "l" }, content: [
      { type: "listItem", attrs: { nodeId: "li" }, content: [para("p", "onetwo")] },
    ] }]);
    const listItem = editor.getState().schema.nodes["listItem"];
    if (!listItem) throw new Error("no listItem");
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, 6)));
    splitListItem(listItem)(editor.getState(), (tr) => editor.applyTransaction(tr));
    const ids: unknown[] = [];
    editor.getState().doc.descendants((node) => {
      if (node.isBlock) ids.push(node.attrs["nodeId"]);
    });
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is accepted with each half under ids of its own, the text before the break keeping the item's", () => {
    const editor = editorWith([{ type: "bulletList", attrs: { nodeId: "l" }, content: [
      { type: "listItem", attrs: { nodeId: "li" }, content: [para("p", "onetwo")] },
    ] }]);
    const listItem = editor.getState().schema.nodes["listItem"];
    if (!listItem) throw new Error("no listItem");
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, 6)));
    splitListItem(listItem)(editor.getState(), (tr) => editor.applyTransaction(tr));
    expect(reviewChanges(editor, { accepted: pendingActs(editor).map((a) => a.primary.id), rejected: [] }).status).toBe("applied");
    const items: Array<[unknown, string]> = [];
    editor.getState().doc.child(0).forEach((item) => items.push([item.attrs["nodeId"], item.textContent]));
    expect(items[0]).toEqual(["li", "one"]);
    expect(items[1]?.[1]).toBe("two");
    expect(items[1]?.[0]).not.toBe("li");
    expect(pendingActs(editor)).toHaveLength(0);
  });

  it.each([["at the item's start", 3], ["in the item's text", 6]])("is rejected %s back into the one item, under its ids", (_where, at) => {
    const editor = editorWith([{ type: "bulletList", attrs: { nodeId: "l" }, content: [
      { type: "listItem", attrs: { nodeId: "li" }, content: [para("p", "onetwo")] },
    ] }]);
    const listItem = editor.getState().schema.nodes["listItem"];
    if (!listItem) throw new Error("no listItem");
    editor.applyTransaction(editor.getState().tr.setSelection(TextSelection.create(editor.getState().doc, at)));
    splitListItem(listItem)(editor.getState(), (tr) => editor.applyTransaction(tr));
    expect(reviewChanges(editor, { accepted: [], rejected: pendingActs(editor).map((a) => a.primary.id) }).status).toBe("applied");
    const list = editor.getState().doc.child(0);
    const blocks: Array<[string, unknown, string]> = [[list.type.name, list.attrs["nodeId"], list.textContent]];
    list.descendants((node) => {
      if (node.isBlock) blocks.push([node.type.name, node.attrs["nodeId"], node.textContent]);
    });
    expect(blocks).toEqual([["bulletList", "l", "onetwo"], ["listItem", "li", "onetwo"], ["paragraph", "p", "onetwo"]]);
  });
});

describe("a tracked paste of a copy", () => {
  it("gives a pasted copy of a horizontal rule or a page break its own id", () => {
    for (const type of ["horizontalRule", "pageBreak"]) {
      const editor = editorWith([para("a", "Alpha"), { type, attrs: { nodeId: "leaf" } }, para("b", "Beta")]);
      const leaf = editor.getState().doc.child(1);
      editor.applyTransaction(editor.getState().tr.insert(editor.getState().doc.content.size, leaf));
      const ids = topIds(editor);
      expect(ids.filter((id) => id === "leaf")).toHaveLength(1);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("a tracked cut and paste of a whole block", () => {
  it("is recorded as a move, so the pasted block keeps its id", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    const doc = editor.getState().doc;
    const first = doc.child(0);
    editor.applyTransaction(editor.getState().tr.delete(0, first.nodeSize).setMeta("uiEvent", "cut"));
    const end = editor.getState().doc.content.size;
    editor.applyTransaction(editor.getState().tr.replace(end, end, new Slice(doc.slice(0, first.nodeSize).content, 0, 0)).setMeta("uiEvent", "paste"));
    const pasted = editor.getState().doc.lastChild;
    expect(pasted?.textContent).toBe("Alpha");
    expect(pasted?.attrs["nodeId"]).toBe("a");
    const moves = pendingActs(editor).filter((act) => act.records.some((r) => r.dataTracked.moveId || r.dataTracked.moveNodeId));
    expect(moves).toHaveLength(1);
  });

  it("is not the cut when what is pasted is a copy of another block that reads the same", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Alpha"), para("z", "z")]);
    const doc = editor.getState().doc;
    const first = doc.child(0);
    const copyOfB = doc.slice(first.nodeSize, first.nodeSize + doc.child(1).nodeSize);
    editor.applyTransaction(editor.getState().tr.delete(0, first.nodeSize).setMeta("uiEvent", "cut"));
    const end = editor.getState().doc.content.size;
    editor.applyTransaction(editor.getState().tr.replace(end, end, copyOfB).setMeta("uiEvent", "paste"));
    const ids = topIds(editor);
    expect(ids.slice(0, 3)).toEqual(["a", "b", "z"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pendingActs(editor).filter((act) => act.records.some((r) => r.dataTracked.moveId))).toHaveLength(0);
  });

  it("keeps no id of a block the cut only took part of", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta"), para("z", "z")]);
    const doc = editor.getState().doc;
    // "pha" + break + "Be": both blocks stay, each missing some words.
    const from = 3;
    const to = doc.child(0).nodeSize + 3;
    const cut = doc.slice(from, to);
    editor.applyTransaction(editor.getState().tr.delete(from, to).setMeta("uiEvent", "cut"));
    const end = editor.getState().doc.content.size;
    editor.applyTransaction(editor.getState().tr.replace(end, end, new Slice(cut.content, 0, 0)).setMeta("uiEvent", "paste"));
    const ids = topIds(editor);
    expect(ids.slice(0, 2)).toEqual(["a", "b"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("a pending move through undo and redo", () => {
  const moved = () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    const state = editor.getState();
    const first = state.doc.child(0);
    editor.applyTransaction(state.tr.insert(state.doc.content.size, first).delete(0, first.nodeSize));
    return editor;
  };
  const run = (editor: ServerEditor, command: typeof undo) => command(editor.getState(), (tr) => editor.applyTransaction(tr));
  const copiesOfA = (editor: ServerEditor) => topIds(editor).filter((id) => id === "a").length;
  const decide = (editor: ServerEditor, decision: "accepted" | "rejected") => {
    const ids = pendingActs(editor).map((a) => a.primary.id);
    return reviewChanges(editor, decision === "accepted" ? { accepted: ids, rejected: [] } : { accepted: [], rejected: ids });
  };

  it("keeps the pair's id after the move is undone and redone", () => {
    const editor = moved();
    run(editor, undo);
    expect(topIds(editor)).toEqual(["a", "b"]);
    run(editor, redo);
    expect(copiesOfA(editor)).toBe(2);
  });

  it("keeps it when an accepted move is undone, then rejected", () => {
    const editor = moved();
    expect(decide(editor, "accepted").status).toBe("applied");
    run(editor, undo);
    expect(copiesOfA(editor)).toBe(2);
    expect(decide(editor, "rejected").status).toBe("applied");
    expect(topIds(editor)).toEqual(["a", "b"]);
  });

  it("keeps it when a rejected move is undone, then rejected again", () => {
    const editor = moved();
    expect(decide(editor, "rejected").status).toBe("applied");
    run(editor, undo);
    expect(copiesOfA(editor)).toBe(2);
    expect(decide(editor, "rejected").status).toBe("applied");
    expect(topIds(editor)).toEqual(["a", "b"]);
  });
});

describe("a pending move", () => {
  it("keeps one id on both copies, through later edits", () => {
    const editor = editorWith([para("a", "Alpha"), para("b", "Beta")]);
    const state = editor.getState();
    const moved = state.doc.child(0);
    editor.applyTransaction(state.tr.insert(state.doc.content.size, moved).delete(0, moved.nodeSize));
    expect(topIds(editor).filter((id) => id === "a")).toHaveLength(2);
    editor.applyTransaction(editor.getState().tr.insertText("!", editor.getState().doc.child(0).nodeSize + 2));
    expect(topIds(editor).filter((id) => id === "a")).toHaveLength(2);
  });
});

describe("deleting a pending move's moved copy", () => {
  /** Moves the first block to just before the block at `before` (or the end), then deletes the moved copy. */
  function moveThenDelete(content: DocNode[], before?: number) {
    const editor = editorWith(content);
    const state = editor.getState();
    const first = state.doc.child(0);
    let target = 0;
    state.doc.forEach((node, offset, index) => {
      if (index < (before ?? state.doc.childCount)) target = offset + node.nodeSize;
    });
    editor.applyTransaction(state.tr.insert(target, first).delete(0, first.nodeSize));
    const doc = editor.getState().doc;
    let copy = -1;
    doc.forEach((node, offset) => {
      if (node.attrs["nodeId"] === "a" && offset > 0) copy = offset;
    });
    const copyNode = doc.nodeAt(copy);
    if (!copyNode) throw new Error("no moved copy");
    editor.applyTransaction(editor.getState().tr.delete(copy, copy + copyNode.nodeSize).setMeta("uiEvent", "cut"));
    return editor;
  }

  it("proposes deleting it, as a deletion and no longer a move, when it is the last block", () => {
    const editor = moveThenDelete([para("a", "Alpha"), para("b", "Beta")]);
    const operations: string[][] = [];
    editor.getState().doc.forEach((node) => {
      const records: Array<{ operation?: string; status?: string }> = Array.isArray(node.attrs["dataTracked"]) ? node.attrs["dataTracked"] : [];
      if (node.attrs["nodeId"] === "a") operations.push(records.filter((r) => r.status === "pending").map((r) => r.operation ?? ""));
    });
    expect(operations.length).toBeGreaterThan(0);
    for (const ops of operations) {
      expect(ops).toContain("delete");
      expect(ops).not.toContain("move");
    }
  });

  it("leaves the block after it as it was", () => {
    const editor = moveThenDelete([
      para("a", "Alpha"),
      para("b", "Beta"),
      { type: "heading", attrs: { nodeId: "h", level: 2 }, content: [{ type: "text", text: "Head" }] },
    ], 2);
    let heading: PMNode | undefined;
    editor.getState().doc.forEach((node) => {
      if (node.type.name === "heading") heading = node;
    });
    expect(heading?.attrs["nodeId"]).toBe("h");
    expect(heading?.attrs["level"]).toBe(2);
  });
});
