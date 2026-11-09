/**
 * Deleting what you added yourself takes it back out, as Word does: the
 * document returns to what it was, with no change left to review.
 */
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
  /** The text of each block, without ids or tracking records. */
  blocks() {
    const out: string[] = [];
    this.getState().doc.descendants((node) => {
      if (node.isTextblock) out.push(node.textContent);
    });
    return out;
  }
}

function suggesting(content: DocNode[]) {
  return new KeyEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content },
  });
}

/** Presses `key` until no change is left, at most `limit` times. */
function pressUntilClean(editor: KeyEditor, key: string, limit: number) {
  for (let i = 0; i < limit && editor.pending() > 0; i++) editor.press(key);
}

describe("a list item you added", () => {
  const added = () => {
    const editor = suggesting([{ type: "bulletList", content: [item("one")] }, para("after")]);
    editor.caretAt(6);
    editor.press("Enter");
    return editor;
  };

  it("is taken back out by Backspace, leaving the list as it was", () => {
    const editor = added();
    pressUntilClean(editor, "Backspace", 2);
    expect(editor.pending()).toBe(0);
    expect(editor.blocks()).toEqual(["one", "after"]);
    expect(editor.getState().doc.child(0).childCount).toBe(1);
  });

  it("is taken back out by Delete from the item above", () => {
    const editor = added();
    editor.caretAt(6);
    pressUntilClean(editor, "Delete", 2);
    expect(editor.pending()).toBe(0);
    expect(editor.blocks()).toEqual(["one", "after"]);
  });
});

describe("a paragraph you added", () => {
  it("is taken back out by Backspace", () => {
    const editor = suggesting([para("one"), para("after")]);
    editor.caretAt(4);
    editor.press("Enter");
    pressUntilClean(editor, "Backspace", 2);
    expect(editor.pending()).toBe(0);
    expect(editor.blocks()).toEqual(["one", "after"]);
  });
});

describe("a node you added", () => {
  it.each([
    ["an image", { type: "image", attrs: { src: "https://example.com/a.png" } }, true],
    ["a horizontal line", { type: "horizontalRule" }, false],
  ])("is taken back out when %s is deleted", (_name, json, inline) => {
    const editor = suggesting([para("one"), para("after")]);
    const node = editor.getState().schema.nodeFromJSON(json);
    const at = inline ? 4 : 5;
    editor.applyTransaction(editor.getState().tr.insert(at, node));
    expect(editor.pending()).toBeGreaterThan(0);
    editor.applyTransaction(editor.getState().tr.delete(at, at + node.nodeSize));
    expect(editor.pending()).toBe(0);
    expect(editor.blocks()).toEqual(["one", "after"]);
    let found = false;
    editor.getState().doc.descendants((child) => {
      if (child.type.name === node.type.name) found = true;
    });
    expect(found).toBe(false);
  });

  it("is taken back out from a nested list", () => {
    const editor = suggesting([{ type: "bulletList", content: [{ type: "listItem", content: [para("one"), { type: "bulletList", content: [item("two")] }] }] }, para("after")]);
    let end = -1;
    editor.getState().doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "two") end = pos + 1 + node.content.size;
    });
    editor.caretAt(end);
    editor.press("Enter");
    pressUntilClean(editor, "Backspace", 2);
    expect(editor.pending()).toBe(0);
    expect(editor.blocks()).toEqual(["one", "two", "after"]);
  });
});
