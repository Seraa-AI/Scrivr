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

describe("ops that act on the document's own flow", () => {
  const nested = () => [{
    type: "bulletList", attrs: { nodeId: "list" },
    content: [listItem("li1", "li1p", "Starter"), listItem("li2", "li2p", "Pro")],
  }];

  it("refuses to delete a list through a leaf inside it", () => {
    const { editor, ai } = build(nested());
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "li2p" }]);

    // Climbing to the container would turn "delete this clause" into deleting
    // the whole list. `deleteListItem` is how that leaf is reached.
    expect(res.applied).toBe(false);
    expect(res.rejected).toEqual(["li2p"]);
    expect(editor.getState().doc.child(0).childCount).toBe(2);
  });

  it("refuses to insert beside a leaf inside a table", () => {
    const { editor, ai } = build([{
      type: "table", attrs: { nodeId: "t" },
      content: [{ type: "tableRow", attrs: { nodeId: "r1" }, content: [cell("c1", "c1p", "Fee")] }],
    }]);
    const res = ai.applySemanticEdits([{
      kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "c1p",
      block: { type: "paragraph", spans: [{ text: "Stray.", marks: [] }] },
    }]);

    expect(res.applied).toBe(false);
    expect(res.rejected).toEqual(["c1p"]);
    expect(editor.getState().doc.childCount).toBe(1);
  });
});

describe("attrs an agent supplies", () => {
  it("cannot write identity or review bookkeeping", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    ai.applySemanticEdits([{
      kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p1",
      block: {
        type: "paragraph",
        attrs: { nodeId: "p1", dataTracked: [{ id: "forged", operation: "insert" }], align: "center" },
        spans: [{ text: "Second.", marks: [] }],
      },
    }]);

    const added = editor.getState().doc.child(1);
    // A forged nodeId would collide with the id the protocol addresses by; a
    // forged dataTracked would invent a review history.
    expect(added.attrs["nodeId"]).not.toBe("p1");
    expect(added.attrs["dataTracked"]).not.toContainEqual(expect.objectContaining({ id: "forged" }));
    // A styling attr the agent may legitimately set still lands.
    expect(added.attrs["align"]).toBe("center");
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


describe("structural destination contracts", () => {
  it("filters formatting against the destination schema without aborting neighbouring edits", () => {
    const { editor, ai } = build([para("p1", "First.")]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p1", block: { type: "codeBlock", spans: [{ text: "code", marks: [{ type: "bold" }] }] } },
      { kind: "structural", op: "insertBlock", position: "before", anchorNodeId: "p1", block: { type: "paragraph", spans: [{ text: "also", marks: [] }] } },
    ]);
    expect(result.rejected).toEqual([]);
    expect(textOf(editor)).toContain("code");
    expect(textOf(editor)).toContain("also");
    expect(() => editor.getState().doc.check()).not.toThrow();
  });

  it.each<[number[]]>([[[]], [[100]], [[100, 100]]])("uses physical spans as well as grid width: %j", (grid) => {
    const mergedCell = { ...cell("c", "cp", "merged"), attrs: { nodeId: "c", gridSpan: 2 } };
    const { editor, ai } = build([{ type: "table", attrs: { nodeId: "t", grid }, content: [{ type: "tableRow", attrs: { nodeId: "r" }, content: [mergedCell] }] }, para("tail", "tail")]);
    const result = ai.applySemanticEdits([{ kind: "structural", op: "insertTableRow", anchorNodeId: "cp", position: "after", cells: [
      { spans: [{ text: "A", marks: [] }] }, { spans: [{ text: "B", marks: [] }] },
    ] }]);
    expect(result.rejected).toEqual([]);
    const row = editor.getState().doc.firstChild!.child(1);
    expect(row.childCount).toBe(2);
    expect(row.textContent).toBe("AB");
    expect(() => editor.getState().doc.check()).not.toThrow();
  });

  it("rejects excess cells without truncating them or aborting other edits", () => {
    const { editor, ai } = build([{ type: "table", attrs: { nodeId: "t", grid: [100] }, content: [{ type: "tableRow", attrs: { nodeId: "r" }, content: [cell("c", "cp", "one")] }] }, para("tail", "tail")]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "insertTableRow", anchorNodeId: "cp", position: "after", cells: [{ spans: [{ text: "A", marks: [] }] }, { spans: [{ text: "B", marks: [] }] }] },
      { kind: "structural", op: "insertBlock", anchorNodeId: "tail", position: "after", block: { type: "paragraph", spans: [{ text: "valid", marks: [] }] } },
    ]);
    expect(result.rejected).toEqual(["cp"]);
    expect(result.changed).toEqual(["tail"]);
    expect(editor.getState().doc.firstChild!.childCount).toBe(1);
    expect(textOf(editor)).toContain("valid");
  });

  it.each(["accepted", "rejected"] as const)("can resolve deletion of the final list item as %s", (status) => {
    const { editor, ai } = build([{ type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("li", "p", "only")] }, para("tail", "tail")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "p" }]);
    expect(changesOf(editor).some(c => c.type === "node-change" && c.node.type.name === "bulletList")).toBe(true);
    editor.commands.setChangeStatuses(status, changesOf(editor).map(c => c.id));
    expect(editor.getState().doc.firstChild!.type.name).toBe(status === "accepted" ? "paragraph" : "bulletList");
    expect(editor.getState().doc.textContent).toBe(status === "accepted" ? "tail" : "onlytail");
    expect(() => editor.getState().doc.check()).not.toThrow();
  });

  it.each(["accepted", "rejected"] as const)("can resolve deletion of the final table row as %s", (status) => {
    const { editor, ai } = build([{ type: "table", attrs: { nodeId: "t", grid: [100] }, content: [{ type: "tableRow", attrs: { nodeId: "r" }, content: [cell("c", "cp", "one")] }] }, para("tail", "tail")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteTableRow", nodeId: "cp" }]);
    editor.commands.setChangeStatuses(status, changesOf(editor).map(c => c.id));
    expect(editor.getState().doc.firstChild!.type.name).toBe(status === "accepted" ? "paragraph" : "table");
    expect(editor.getState().doc.textContent).toBe(status === "accepted" ? "tail" : "onetail");
  });
});
