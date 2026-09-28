/**
 * Structural edits applied as tracked suggestions.
 *
 * The agent never states a position — it names a neighbour it was shown and
 * says which side. Nothing is applied outright: the engine's own transaction
 * tracking turns each op into a pending node-change the reviewer accepts or
 * rejects, so a proposed clause is visible as a proposal.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit, Table } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";
import type { SemanticEdit } from "../../schema/edit";

const para = (nodeId: string, text: string) => ({
  type: "paragraph",
  attrs: { nodeId },
  content: [{ type: "text", text }],
});
const listItem = (itemId: string, textId: string, text: string) => ({
  type: "listItem",
  attrs: { nodeId: itemId },
  content: [para(textId, text)],
});
const cell = (cellId: string, textId: string, text: string) => ({
  type: "tableCell",
  attrs: { nodeId: cellId },
  content: [para(textId, text)],
});

const build = (content: unknown[]) => {
  const editor = new ServerEditor({
    extensions: [StarterKit, Table, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true }), AiToolkit],
    content: { type: "doc", content },
  });
  return { editor, ai: getAiToolkit(editor)! };
};
const changesOf = (editor: ServerEditor) =>
  trackChangesPluginKey.getState(editor.getState())?.changeSet.changes ?? [];
const nodeOps = (editor: ServerEditor) =>
  changesOf(editor).filter((c) => c.type === "node-change").map((c) => c.dataTracked.operation);
const textOf = (editor: ServerEditor) => editor.getState().doc.textBetween(0, editor.getState().doc.content.size, "\n");

describe("insertBlock", () => {
  const edit = (position: "before" | "after"): SemanticEdit => ({
    kind: "structural", op: "insertBlock", position, anchorNodeId: "p2",
    block: { type: "paragraph", spans: [{ text: "A new clause.", marks: [] }] },
  });

  it("places a block on the named side of its anchor, as a pending insert", () => {
    const { editor, ai } = build([para("p1", "First."), para("p2", "Second.")]);
    const res = ai.applySemanticEdits([edit("before")]);

    expect(res.applied).toBe(true);
    expect(textOf(editor)).toBe("First.\nA new clause.\nSecond.");
    expect(nodeOps(editor)).toContain("insert");
  });

  it("honours `after` as the other side of the same anchor", () => {
    const { editor, ai } = build([para("p1", "First."), para("p2", "Second.")]);
    ai.applySemanticEdits([edit("after")]);
    expect(textOf(editor)).toBe("First.\nSecond.\nA new clause.");
  });

  it("reports an anchor that is not in the document instead of guessing one", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    const res = ai.applySemanticEdits([{
      kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "ghost",
      block: { type: "paragraph", spans: [{ text: "A new clause.", marks: [] }] },
    }]);

    expect(res.applied).toBe(false);
    expect(res.notFound).toEqual(["ghost"]);
    expect(textOf(editor)).toBe("First.");
  });

  it("carries a heading's level", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    ai.applySemanticEdits([{
      kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p1",
      block: { type: "heading", level: 3, spans: [{ text: "Indemnity", marks: [] }] },
    }]);
    const added = editor.getState().doc.child(1);
    expect(added.type.name).toBe("heading");
    expect(added.attrs["level"]).toBe(3);
  });
});

describe("deleteBlock", () => {
  it("marks the block deleted rather than removing it", () => {
    const { editor, ai } = build([para("p1", "First."), para("p2", "Second.")]);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "p2" }]);

    expect(res.applied).toBe(true);
    // Still present — a suggestion the reviewer can reject.
    expect(textOf(editor)).toBe("First.\nSecond.");
    expect(nodeOps(editor)).toContain("delete");
  });
});

describe("list items", () => {
  const doc = () => [{
    type: "bulletList", attrs: { nodeId: "list" },
    content: [listItem("li1", "li1p", "Starter"), listItem("li2", "li2p", "Pro")],
  }];

  it("inserts an item beside the item holding the anchor leaf", () => {
    const { editor, ai } = build(doc());
    const res = ai.applySemanticEdits([{
      kind: "structural", op: "insertListItem", position: "after", anchorNodeId: "li2p",
      item: { spans: [{ text: "Enterprise", marks: [] }] },
    }]);

    expect(res.applied).toBe(true);
    expect(textOf(editor)).toContain("Enterprise");
    expect(nodeOps(editor)).toContain("insert");
  });

  it("deletes the whole item, not only the leaf the id names", () => {
    const { editor, ai } = build(doc());
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "li2p" }]);

    expect(res.applied).toBe(true);
    expect(nodeOps(editor)).toContain("delete");
    // The item node itself is what was marked, not just its paragraph.
    const marked = changesOf(editor).find((c) => c.type === "node-change" && c.node.type.name === "listItem");
    expect(marked).toBeDefined();
  });
});

describe("table rows", () => {
  const doc = () => [{
    type: "table", attrs: { nodeId: "t" },
    content: [
      { type: "tableRow", attrs: { nodeId: "r1" }, content: [cell("c1", "c1p", "Fee"), cell("c2", "c2p", "100")] },
      { type: "tableRow", attrs: { nodeId: "r2" }, content: [cell("c3", "c3p", "Cap"), cell("c4", "c4p", "200")] },
    ],
  }];

  it("inserts a row with the anchor row's cell count", () => {
    const { editor, ai } = build(doc());
    const res = ai.applySemanticEdits([{
      kind: "structural", op: "insertTableRow", position: "after", anchorNodeId: "c1p",
      cells: [{ spans: [{ text: "Interest", marks: [] }] }, { spans: [{ text: "8%", marks: [] }] }],
    }]);

    expect(res.applied).toBe(true);
    const table = editor.getState().doc.child(0);
    expect(table.childCount).toBe(3);
    expect(table.child(1).childCount).toBe(2);
    expect(textOf(editor)).toContain("Interest");
  });

  it("pads a row when the agent supplies too few cells", () => {
    const { editor, ai } = build(doc());
    ai.applySemanticEdits([{
      kind: "structural", op: "insertTableRow", position: "after", anchorNodeId: "c1p",
      cells: [{ spans: [{ text: "Interest", marks: [] }] }],
    }]);
    expect(editor.getState().doc.child(0).child(1).childCount).toBe(2);
  });

  it("marks a row deleted", () => {
    const { editor, ai } = build(doc());
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteTableRow", nodeId: "c3p" }]);

    expect(res.applied).toBe(true);
    const marked = changesOf(editor).find((c) => c.type === "node-change" && c.node.type.name === "tableRow");
    expect(marked).toBeDefined();
  });
});

describe("mixed batches", () => {
  it("applies rich and structural edits together", () => {
    const { editor, ai } = build([para("p1", "First."), para("p2", "Second.")]);
    const res = ai.applySemanticEdits([
      { kind: "richText", nodeId: "p1", spans: [{ text: "First", marks: [{ type: "bold" }] }, { text: ".", marks: [] }] },
      { kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p2", block: { type: "paragraph", spans: [{ text: "Third.", marks: [] }] } },
    ]);

    expect(res.applied).toBe(true);
    expect(res.changed).toContain("p1");
    expect(textOf(editor)).toContain("Third.");
  });

  it("applies the ops it can resolve and reports the ones it cannot", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    const res = ai.applySemanticEdits([
      { kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p1", block: { type: "paragraph", spans: [{ text: "Second.", marks: [] }] } },
      { kind: "structural", op: "deleteBlock", nodeId: "ghost" },
    ]);

    expect(res.applied).toBe(true);
    expect(res.notFound).toEqual(["ghost"]);
    expect(textOf(editor)).toContain("Second.");
  });

  it("rejects a list op aimed at a block that is not in a list", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "p1" }]);

    expect(res.applied).toBe(false);
    expect(res.rejected).toEqual(["p1"]);
    expect(textOf(editor)).toBe("First.");
  });
});

