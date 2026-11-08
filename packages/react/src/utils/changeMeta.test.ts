import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { findChanges, TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
import { blockText, decisionLabel, getChangeMeta } from "./changeMeta";

const cell = (text: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const row = (...texts: string[]) => ({ type: "tableRow", content: texts.map(cell) });

function suggestingInTable() {
  return new ServerEditor({
    extensions: [StarterKit.configure({ table: true }), TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: [{ type: "table", attrs: { layout: "fixed", grid: [] }, content: [row("a", "b"), row("c", "d")] }] },
  });
}

const rowLabels = (editor: ServerEditor) =>
  findChanges(editor.getState()).pending
    .filter((change) => change.type === "node-change" && change.node.type.name === "tableRow")
    .map((change) => getChangeMeta(change).label);

describe("a table row change is named as a row", () => {
  it("as added", () => {
    const editor = suggestingInTable();
    const table = editor.getState().doc.child(0);
    const end = 1 + table.child(0).nodeSize + table.child(1).nodeSize;
    editor.applyTransaction(editor.getState().tr.insert(end, editor.getState().schema.nodeFromJSON(row("e", "f"))));
    expect(rowLabels(editor)).toEqual(["Row added"]);
  });

  it("as removed", () => {
    const editor = suggestingInTable();
    const first = editor.getState().doc.child(0).child(0);
    editor.applyTransaction(editor.getState().tr.delete(1, 1 + first.nodeSize));
    expect(rowLabels(editor)).toEqual(["Row removed"]);
  });

  it("is decided as the whole row, and previewed cell by cell", () => {
    const editor = suggestingInTable();
    const table = editor.getState().doc.child(0);
    const end = 1 + table.child(0).nodeSize + table.child(1).nodeSize;
    editor.applyTransaction(editor.getState().tr.insert(end, editor.getState().schema.nodeFromJSON(row("Headset", "Yes"))));
    const added = findChanges(editor.getState()).pending.find((change) => change.type === "node-change" && change.node.type.name === "tableRow");
    if (!added || added.type !== "node-change") throw new Error("no row change");
    const meta = getChangeMeta(added);

    expect([decisionLabel("Accept", meta), decisionLabel("Reject", meta)]).toEqual(["Accept row", "Reject row"]);
    expect(blockText(added.node)).toBe("Headset · Yes");
  });
});

describe("an image's layout change is named by what changed", () => {
  const withImage = () => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "https://example.com/a.png", wrapMode: "square" } }] }] },
  });
  const relabel = (attrs: Record<string, unknown>) => {
    const editor = withImage();
    const image = editor.getState().doc.child(0).child(0);
    editor.applyTransaction(editor.getState().tr.setNodeMarkup(1, undefined, { ...image.attrs, ...attrs }));
    return findChanges(editor.getState()).pending
      .filter((change) => change.type === "node-attr-change")
      .map((change) => getChangeMeta(change).label);
  };

  it("as moved, when only where it sits changed", () => {
    expect(relabel({ xAlign: "center" })).toEqual(["Image moved"]);
  });

  it("as a style change, when how text wraps it changed", () => {
    expect(relabel({ wrapMode: "top-bottom" })).toEqual(["Style changed"]);
  });
});
