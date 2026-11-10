/** A list level suggested with Tab is one change on that item. */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";

type DocNode = Record<string, unknown>;
const para = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string): DocNode => ({ type: "listItem", content: [para(text)] });

class KeyEditor extends ServerEditor {
  press(name: string): boolean {
    const command = this.manager.buildKeymap()[name];
    if (!command) throw new Error(`no binding for ${name}`);
    return command(this.getState(), (tr) => this.applyTransaction(tr));
  }
  caretAt(pos: number) {
    this.applyTransaction(this.getState().tr.setSelection(TextSelection.create(this.getState().doc, pos)));
  }
  pending() {
    return trackChangesPluginKey.getState(this.getState())?.changeSet.pending.length ?? 0;
  }
}

function suggesting(content: DocNode[]) {
  return new KeyEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content },
  });
}

describe("Tab on a list item, suggested", () => {
  it("is one change on that item, which rejecting takes back", () => {
    const editor = suggesting([{ type: "bulletList", content: [item("one"), item("two")] }]);
    editor.caretAt(3);
    editor.press("Tab");
    expect(editor.getState().doc.child(0).child(0).attrs["levelOffset"]).toBe(1);
    const operations = trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map((change) => change.dataTracked.operation);
    expect(operations).toEqual(["set_attrs"]);
    const ids = trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map((change) => change.id) ?? [];
    editor.commands.setChangeStatuses("rejected", ids);
    expect(editor.getState().doc.child(0).child(0).attrs["levelOffset"]).toBe(0);
    expect(editor.pending()).toBe(0);
  });
});

describe("moving a list item you added, suggested", () => {
  it("records no list change: where it sits is part of your proposal", () => {
    const editor = suggesting([{ type: "bulletList", content: [{ type: "listItem", content: [para("one"), { type: "bulletList", content: [item("two")] }] }] }]);
    let end = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "two") end = pos + 1 + node.content.size;
    });
    editor.caretAt(end);
    editor.press("Enter");
    editor.press("Shift-Tab");
    const operations = trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map((change) => change.dataTracked.operation);
    expect(operations).not.toContain("list_change");
  });
});
