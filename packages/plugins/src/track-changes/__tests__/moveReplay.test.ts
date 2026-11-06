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
const changes = (editor: ServerEditor) => trackChangesPluginKey.getState(editor.getState())!.changeSet.changes;

describe("move replay coordinates", () => {
  for (const backward of [false, true]) {
    for (const insertFirst of [false, true]) {
      it(`reviews ${backward ? "backward" : "forward"} moves with ${insertFirst ? "insert" : "delete"} first`, () => {
        const editor = build();
        const original = editor.getState().doc;
        const node = backward ? original.lastChild! : original.firstChild!;
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
        editor.commands.setChangeStatuses("rejected", [moves[0]!.id]);
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
