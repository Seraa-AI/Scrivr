/**
 * Block ids are unique at the source: a split's halves differ, while a pending
 * move's two copies keep the one id they share by design.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { redo, splitListItem, TextSelection, undo } from "@scrivr/core/pm";
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
