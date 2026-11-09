/** A list level suggested with Tab is a list change, reviewed as one. */
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

describe("Tab on a list's first item, suggested", () => {
  it("is recorded as a list change on its items, which rejecting takes back", () => {
    const editor = suggesting([{ type: "bulletList", content: [item("one"), item("two")] }]);
    editor.caretAt(3);
    editor.press("Tab");
    expect(editor.getState().doc.child(0).attrs["levelOffset"]).toBe(1);
    const operations = trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map((change) => change.dataTracked.operation);
    expect(operations).toEqual(["list_change", "list_change"]);
    const ids = trackChangesPluginKey.getState(editor.getState())?.changeSet.pending.map((change) => change.id) ?? [];
    editor.commands.setChangeStatuses("rejected", ids);
    expect(editor.getState().doc.child(0).attrs["levelOffset"]).toBe(0);
    expect(editor.pending()).toBe(0);
  });
});
