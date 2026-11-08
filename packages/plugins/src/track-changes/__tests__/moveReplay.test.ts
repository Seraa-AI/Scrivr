import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";

function build() {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: ["alpha", "beta", "gamma"].map(text => ({
      type: "paragraph", attrs: { nodeId: text }, content: [{ type: "text", text }],
    })) },
  });
}
const changes = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? [];

describe("move replay coordinates", () => {
  for (const backward of [false, true]) {
    for (const insertFirst of [false, true]) {
      it(`reviews ${backward ? "backward" : "forward"} moves with ${insertFirst ? "insert" : "delete"} first`, () => {
        const editor = build();
        const original = editor.getState().doc;
        const node = backward ? original.child(original.childCount - 1) : original.child(0);
        const from = backward ? original.content.size - node.nodeSize : 0;
        const at = backward ? 0 : original.content.size;
        const tr = editor.getState().tr;
        if (insertFirst) {
          tr.insert(at, node);
          const shifted = from + (at <= from ? node.nodeSize : 0);
          tr.delete(shifted, shifted + node.nodeSize);
        } else {
          tr.delete(from, from + node.nodeSize);
          tr.insert(at > from ? at - node.nodeSize : at, node);
        }
        editor.applyTransaction(tr);
        expect(() => editor.getState().doc.check()).not.toThrow();
        const moves = changes(editor).filter(c => c.dataTracked.operation === "move");
        expect(moves).toHaveLength(1);
        editor.commands.setChangeStatuses("rejected", moves.map(move => move.id));
        const restored = editor.getState().doc;
        expect(restored.childCount).toBe(original.childCount);
        restored.forEach((node, _pos, index) => {
          expect(node.content.eq(original.child(index).content)).toBe(true);
          // Review cleanup represents absent tracking as null rather than [].
          expect({ ...node.attrs, dataTracked: null }).toEqual({ ...original.child(index).attrs, dataTracked: null });
        });
        expect(changes(editor)).toHaveLength(0);
      });
    }
  }

  it("keeps tracked inserted content valid for a parent that forbids marks", () => {
    const editor = build();
    const { schema } = editor;
    const tr = editor.getState().tr;
    tr.insert(0, schema.node("codeBlock", { nodeId: "code" }, schema.text("code")));
    tr.insert(0, schema.node("paragraph", { nodeId: "before" }, schema.text("before")));
    editor.applyTransaction(tr);
    expect(() => editor.getState().doc.check()).not.toThrow();
    expect(editor.getState().doc.child(0).textContent).toBe("before");
    expect(editor.getState().doc.child(1).textContent).toBe("code");
    expect(changes(editor).some(c => c.type === "node-change" && c.node.type.name === "codeBlock")).toBe(true);
    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(editor.getState().doc.textContent).toBe("alphabetagamma");
  });
});

describe("which deletion and insertion are one move", () => {
  const ids = (editor: ServerEditor) => {
    const out: string[] = [];
    editor.getState().doc.forEach(node => out.push(String(node.attrs["nodeId"])));
    return out;
  };
  const moves = (editor: ServerEditor) => changes(editor).filter(c => c.dataTracked.operation === "move");
  const paragraph = (editor: ServerEditor, nodeId: string | null, text: string) =>
    editor.schema.node("paragraph", { nodeId }, editor.schema.text(text));

  it("an insertion earlier in the transaction does not claim the move's deletion", () => {
    const editor = build();
    const tr = editor.getState().tr;
    const alpha = tr.doc.child(0);
    tr.insert(alpha.nodeSize, paragraph(editor, "new", "new"));
    tr.delete(0, alpha.nodeSize);
    tr.insert(tr.doc.content.size, alpha);
    editor.applyTransaction(tr);

    expect(moves(editor)).toHaveLength(1);
    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(ids(editor)).toEqual(["alpha", "beta", "gamma"]);
  });

  for (const newFirst of [false, true]) {
    it(`a new block that only reads like a moved one is not its copy (${newFirst ? "new block first" : "move first"})`, () => {
      const editor = build();
      const tr = editor.getState().tr;
      const alpha = tr.doc.child(0);
      const twin = paragraph(editor, null, "alpha");
      if (newFirst) tr.insert(alpha.nodeSize + tr.doc.child(1).nodeSize, twin);
      tr.delete(0, alpha.nodeSize);
      tr.insert(tr.doc.content.size, alpha);
      if (!newFirst) tr.insert(tr.doc.child(0).nodeSize, twin);
      editor.applyTransaction(tr);

      editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
      expect(ids(editor)).toEqual(["alpha", "beta", "gamma"]);
      expect(changes(editor)).toHaveLength(0);
    });
  }

  it("deleting one empty paragraph while moving another keeps them apart", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "x" } },
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", attrs: { nodeId: "e" } },
        { type: "paragraph", attrs: { nodeId: "c" }, content: [{ type: "text", text: "gamma" }] },
      ] },
    });
    const tr = editor.getState().tr;
    tr.delete(0, tr.doc.child(0).nodeSize);
    const emptyAt = tr.doc.child(0).nodeSize;
    const empty = tr.doc.child(1);
    tr.delete(emptyAt, emptyAt + empty.nodeSize);
    tr.insert(tr.doc.content.size, empty);
    editor.applyTransaction(tr);

    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(ids(editor)).toEqual(["x", "a", "e", "c"]);
  });

  it("a paragraph deleted while its words are typed elsewhere is a deletion and an insertion", () => {
    const editor = build();
    const tr = editor.getState().tr;
    const alpha = tr.doc.child(0).nodeSize;
    tr.delete(alpha, alpha + tr.doc.child(1).nodeSize);
    tr.insertText("beta", 1);
    expect(() => editor.applyTransaction(tr)).not.toThrow();

    expect(moves(editor)).toHaveLength(0);
    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(editor.getState().doc.textContent).toBe("alphabetagamma");
  });

  it("two blocks that read the same are each their own move", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [["twin", "same"], ["other", "same"], ["end", "end"]].map(([nodeId, text]) => ({
        type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }],
      })) },
    });
    const tr = editor.getState().tr;
    for (const _ of [0, 1]) {
      const first = tr.doc.child(0);
      tr.delete(0, first.nodeSize);
      tr.insert(tr.doc.content.size, first);
    }
    editor.applyTransaction(tr);
    expect(moves(editor)).toHaveLength(2);

    for (const move of moves(editor)) editor.commands.setChangeStatuses("rejected", [move.id]);
    expect(ids(editor)).toEqual(["twin", "other", "end"]);
    expect(changes(editor)).toHaveLength(0);
  });

  it("rejects a block added after a list together with a move made since", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "alpha" }] },
        { type: "bulletList", attrs: { nodeId: "list" }, content: [
          { type: "listItem", attrs: { nodeId: "i1" }, content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text: "one" }] }] },
        ] },
        { type: "paragraph", attrs: { nodeId: "z" }, content: [{ type: "text", text: "zeta" }] },
      ] },
    });
    const original = editor.getState().doc.textBetween(0, editor.getState().doc.content.size, "|");
    const added = editor.getState().tr;
    const last = added.doc.child(added.doc.childCount - 1);
    added.insert(added.doc.content.size - last.nodeSize, paragraph(editor, null, "NB"));
    editor.applyTransaction(added);
    const move = editor.getState().tr;
    const zeta = move.doc.child(move.doc.childCount - 1);
    move.delete(move.doc.content.size - zeta.nodeSize, move.doc.content.size);
    move.insert(0, zeta);
    editor.applyTransaction(move);

    editor.commands.setChangeStatuses("rejected", changes(editor).map(c => c.id));
    expect(editor.getState().doc.textBetween(0, editor.getState().doc.content.size, "|")).toBe(original);
    expect(changes(editor)).toHaveLength(0);
  });
});
