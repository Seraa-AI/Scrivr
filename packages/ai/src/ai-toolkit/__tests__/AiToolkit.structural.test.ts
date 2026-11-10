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
import { reviewChanges, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import { unitRichHash } from "@scrivr/export-semantic";
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
const ids = (editor: ServerEditor) => {
  const out: string[] = [];
  editor.getState().doc.forEach((node) => out.push(String(node.attrs["nodeId"])));
  return out;
};
const textOf = (editor: ServerEditor) => editor.getState().doc.textBetween(0, editor.getState().doc.content.size, "\n");

const directions: Array<"forward" | "backward"> = ["forward", "backward"];
const statuses: Array<"accepted" | "rejected"> = ["accepted", "rejected"];

describe("tracked moves", () => {
  for (const direction of directions) {
    for (const status of statuses) {
      it(`${direction} block move is reviewed atomically as ${status}`, () => {
        const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
        const result = ai.applySemanticEdits([{
          kind: "structural", op: "moveBlock", nodeId: direction === "forward" ? "a" : "c",
          anchorNodeId: direction === "forward" ? "c" : "a", position: direction === "forward" ? "after" : "before",
        }]);
        expect(result.changed).toEqual([direction === "forward" ? "a" : "c"]);
        const moves = changesOf(editor).filter(c => c.dataTracked.operation === "move");
        expect(moves).toHaveLength(1);
        editor.commands.setChangeStatuses(status, moves.map(move => move.id));
        expect(textOf(editor)).toBe(status === "rejected" ? "alpha\nbeta\ngamma" : direction === "forward" ? "beta\ngamma\nalpha" : "gamma\nalpha\nbeta");
        expect(changesOf(editor)).toHaveLength(0);
        expect(() => editor.getState().doc.check()).not.toThrow();
      });
    }

    it(`${direction} move resolves its live copy in a later batch after earlier steps shift shadows`, () => {
      const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
      const nodeId = direction === "forward" ? "a" : "c";
      ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId, anchorNodeId: direction === "forward" ? "c" : "a", position: direction === "forward" ? "after" : "before" }]);
      ai.applySemanticEdits([
        { kind: "structural", op: "insertBlock", anchorNodeId: "b", position: "before", block: { type: "paragraph", spans: [{ text: "shift", marks: [] }] } },
        { kind: "structural", op: "insertBlock", anchorNodeId: nodeId, position: "after", block: { type: "paragraph", spans: [{ text: "HERE", marks: [] }] } },
      ]);
      editor.commands.setChangeStatuses("accepted", changesOf(editor).map(c => c.id));
      expect(textOf(editor)).toBe(direction === "forward" ? "shift\nbeta\ngamma\nalpha\nHERE" : "gamma\nHERE\nalpha\nshift\nbeta");
    });

    it(`${direction} list move accepts leaf IDs and rejects atomically`, () => {
      const { editor, ai } = build([{ type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two"), listItem("i3", "p3", "three")] }]);
      const result = ai.applySemanticEdits([{ kind: "structural", op: "moveListItem", nodeId: direction === "forward" ? "p1" : "p3", anchorNodeId: direction === "forward" ? "p3" : "p1", position: direction === "forward" ? "after" : "before" }]);
      expect(result.applied).toBe(true);
      const moves = changesOf(editor).filter(c => c.dataTracked.operation === "move");
      expect(moves).toHaveLength(1);
      editor.commands.setChangeStatuses("rejected", moves.map(move => move.id));
      expect(editor.getState().doc.child(0).textContent).toBe("onetwothree");
      expect(editor.getState().doc.child(0).childCount).toBe(3);
      expect(changesOf(editor)).toHaveLength(0);
    });
  }

  it("resolves an empty moved node through node-level changes", () => {
    const { editor, ai } = build([{ type: "paragraph", attrs: { nodeId: "empty" } }, para("b", "beta")]);
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "empty", anchorNodeId: "b", position: "after" }]);
    ai.applySemanticEdits([{ kind: "structural", op: "insertBlock", anchorNodeId: "empty", position: "after", block: { type: "paragraph", spans: [{ text: "HERE", marks: [] }] } }]);
    editor.commands.setChangeStatuses("accepted", changesOf(editor).map(c => c.id));
    expect(editor.getState().doc.child(0).textContent).toBe("beta");
    expect(editor.getState().doc.child(1).attrs.nodeId).toBe("empty");
    expect(editor.getState().doc.child(2).textContent).toBe("HERE");
  });

  it("refuses cross-list moves before writing any steps", () => {
    const { editor, ai } = build([
      { type: "bulletList", content: [listItem("i1", "p1", "one")] },
      { type: "bulletList", content: [listItem("i2", "p2", "two")] },
    ]);
    const before = editor.getState().doc;
    const result = ai.applySemanticEdits([{ kind: "structural", op: "moveListItem", nodeId: "p1", anchorNodeId: "p2", position: "after" }]);
    expect(result.rejected).toEqual(["p1"]);
    expect(result.applied).toBe(false);
    expect(editor.getState().doc).toBe(before);
  });

  it("resolves a moved ID again within the same batch", () => {
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
    ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "c", anchorNodeId: "a", position: "before" },
      { kind: "structural", op: "insertBlock", anchorNodeId: "c", position: "after", block: { type: "paragraph", spans: [{ text: "HERE", marks: [] }] } },
    ]);
    editor.commands.setChangeStatuses("accepted", changesOf(editor).map(c => c.id));
    expect(textOf(editor)).toBe("gamma\nHERE\nalpha\nbeta");
  });

  it("refuses shadow-only IDs, including descendants of a deleted container", () => {
    const { editor, ai } = build([{ type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i", "p", "one")] }, para("tail", "tail")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "list" }]);
    const before = editor.getState().doc;
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "insertListItem", anchorNodeId: "p", position: "after", item: { spans: [{ text: "bad", marks: [] }] } },
      { kind: "structural", op: "moveBlock", nodeId: "tail", anchorNodeId: "list", position: "before" },
    ]);
    expect(result.rejected).toEqual(["p", "list"]);
    expect(result.applied).toBe(false);
    expect(editor.getState().doc).toBe(before);
  });

  it("reports a move to where the block already is as rejected, changing nothing", () => {
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta")]);
    const before = editor.getState().doc;
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "a", position: "after" },
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "b", position: "before" },
      { kind: "structural", op: "moveBlock", nodeId: "b", anchorNodeId: "a", position: "after" },
    ]);
    expect(result.changed).toEqual([]);
    // Told, so an agent never reports a move that did not happen.
    expect(result.rejected).toEqual(["a", "a", "b"]);
    expect(result.applied).toBe(false);
    expect(editor.getState().doc).toBe(before);
  });

  it("keeps a deletion and a new block that reads the same as two decisions, not a move", () => {
    const { editor, ai } = build([para("a", "foo"), para("b", "keep")]);
    ai.applySemanticEdits([
      { kind: "structural", op: "deleteBlock", nodeId: "a" },
      { kind: "structural", op: "insertBlock", anchorNodeId: "b", position: "after", block: { type: "paragraph", spans: [{ text: "foo", marks: [] }] } },
    ]);
    expect(changesOf(editor).filter(c => c.dataTracked.operation === "move")).toHaveLength(0);
    editor.commands.setChangeStatuses("rejected", changesOf(editor).map(c => c.id));
    expect(textOf(editor)).toBe("foo\nkeep");
    expect(ids(editor)).toEqual(["a", "b"]);
    expect(changesOf(editor)).toHaveLength(0);
  });
});

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

  it("marks a row deleted when named by one of its cells", () => {
    const { editor, ai } = build(doc());
    const res = ai.applySemanticEdits([{ kind: "structural", op: "deleteTableRow", nodeId: "c3" }]);

    expect(res.changed).toEqual(["c3"]);
    expect(changesOf(editor).some((c) => c.type === "node-change" && c.node.type.name === "tableRow")).toBe(true);
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
    const row = editor.getState().doc.child(0).child(1);
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
    expect(editor.getState().doc.child(0).childCount).toBe(1);
    expect(textOf(editor)).toContain("valid");
  });

  it.each(statuses)("can resolve deletion of the final list item as %s", (status) => {
    const { editor, ai } = build([{ type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("li", "p", "only")] }, para("tail", "tail")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteListItem", nodeId: "p" }]);
    expect(changesOf(editor).some(c => c.type === "node-change" && c.node.type.name === "bulletList")).toBe(true);
    editor.commands.setChangeStatuses(status, changesOf(editor).map(c => c.id));
    expect(editor.getState().doc.child(0).type.name).toBe(status === "accepted" ? "paragraph" : "bulletList");
    expect(editor.getState().doc.textContent).toBe(status === "accepted" ? "tail" : "onlytail");
    expect(() => editor.getState().doc.check()).not.toThrow();
  });

  it.each(statuses)("can resolve deletion of the final table row as %s", (status) => {
    const { editor, ai } = build([{ type: "table", attrs: { nodeId: "t", grid: [100] }, content: [{ type: "tableRow", attrs: { nodeId: "r" }, content: [cell("c", "cp", "one")] }] }, para("tail", "tail")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteTableRow", nodeId: "cp" }]);
    editor.commands.setChangeStatuses(status, changesOf(editor).map(c => c.id));
    expect(editor.getState().doc.child(0).type.name).toBe(status === "accepted" ? "paragraph" : "table");
    expect(editor.getState().doc.textContent).toBe(status === "accepted" ? "tail" : "onetail");
  });
});

describe("resolving an id while a move is pending", () => {
  /**
   * A pending move leaves a deleted shadow and a live copy under one nodeId.
   * Document order decides which comes first, so a resolver that takes the
   * first match writes into the shadow for a move in one direction — the edit
   * reports success and then evaporates when the move is accepted.
   */
  for (const direction of directions) {
    it(`a rich edit after a ${direction} move lands on the live copy`, () => {
      const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
      const nodeId = direction === "forward" ? "a" : "c";
      ai.applySemanticEdits([{
        kind: "structural", op: "moveBlock", nodeId,
        anchorNodeId: direction === "forward" ? "c" : "a",
        position: direction === "forward" ? "after" : "before",
      }]);

      const result = ai.applySemanticEdits([{ kind: "richText", nodeId, spans: [{ text: "EDITED", marks: [] }] }]);
      expect(result.changed).toEqual([nodeId]);

      editor.commands.setChangeStatuses("accepted", changesOf(editor).map((c) => c.id));
      // Survives the accept, which is what writing into the shadow would not.
      expect(textOf(editor)).toBe(direction === "forward" ? "beta\ngamma\nEDITED" : "EDITED\nalpha\nbeta");
    });
  }
});

describe("what one batch can ask of tracking", () => {
  it("refuses a second move of one list item named by another of its ids", () => {
    // The item, or a paragraph inside it, names the same item.
    const { editor, ai } = build([{ type: "bulletList", content: [
      listItem("i1", "p1", "one"), listItem("i2", "p2", "two"), listItem("i3", "p3", "three"),
    ] }]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveListItem", nodeId: "p1", anchorNodeId: "p3", position: "after" },
      { kind: "structural", op: "moveListItem", nodeId: "i1", anchorNodeId: "p2", position: "before" },
    ]);

    expect(result.changed).toEqual(["p1"]);
    expect(result.rejected).toEqual(["i1"]);
    editor.commands.setChangeStatuses("accepted", changesOf(editor).map((c) => c.id));
    expect(textOf(editor).trimEnd()).toBe("two\nthree\none");
  });

  it("refuses a move inside a block this batch already moved", () => {
    const { editor, ai } = build([
      { type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two")] },
      para("after", "after"),
    ]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "list", anchorNodeId: "after", position: "after" },
      { kind: "structural", op: "moveListItem", nodeId: "p1", anchorNodeId: "p2", position: "after" },
    ]);

    expect(result.changed).toEqual(["list"]);
    expect(result.rejected).toEqual(["p1"]);
    editor.commands.setChangeStatuses("accepted", changesOf(editor).map((c) => c.id));
    expect(textOf(editor).trimEnd()).toBe("after\none\ntwo");
  });

  it("keeps a move whole when an insertion comes before it in the batch", () => {
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
    ai.applySemanticEdits([
      { kind: "structural", op: "insertBlock", anchorNodeId: "b", position: "after", block: { type: "paragraph", spans: [{ text: "new", marks: [] }] } },
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "c", position: "after" },
    ]);

    expect(changesOf(editor).filter(c => c.dataTracked.operation === "move")).toHaveLength(1);
    editor.commands.setChangeStatuses("rejected", changesOf(editor).map((c) => c.id));
    expect(textOf(editor)).toBe("alpha\nbeta\ngamma");
  });

  it("pairs each move with its own block when two blocks read the same", () => {
    const { editor, ai } = build([para("a", "same"), para("b", "same"), para("c", "end")]);
    ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "c", position: "after" },
      { kind: "structural", op: "moveBlock", nodeId: "b", anchorNodeId: "c", position: "after" },
    ]);
    const moves = changesOf(editor).filter(c => c.dataTracked.operation === "move");
    expect(moves).toHaveLength(2);

    for (const move of moves) {
      const outcome = reviewChanges(editor, { accepted: [], rejected: [move.id] });
      expect(outcome.status).toBe("applied");
    }
    expect(ids(editor)).toEqual(["a", "b", "c"]);
  });

  it("keeps a deleted empty block apart from a moved empty block", () => {
    const empty = (nodeId: string) => ({ type: "paragraph", attrs: { nodeId } });
    const { editor, ai } = build([empty("x"), para("a", "alpha"), empty("e"), para("c", "gamma")]);
    ai.applySemanticEdits([
      { kind: "structural", op: "deleteBlock", nodeId: "x" },
      { kind: "structural", op: "moveBlock", nodeId: "e", anchorNodeId: "c", position: "after" },
    ]);

    editor.commands.setChangeStatuses("rejected", changesOf(editor).map((c) => c.id));
    expect(ids(editor)).toEqual(["x", "a", "e", "c"]);
  });

  it("refuses to delete a block this batch already moved", () => {
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta")]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "b", position: "after" },
      { kind: "structural", op: "deleteBlock", nodeId: "a" },
    ]);

    expect(result.changed).toEqual(["a"]);
    expect(result.rejected).toEqual(["a"]);
  });

  for (const direction of directions) {
    it(`shows an agent one block after a ${direction} move, and takes a guarded edit to it`, () => {
      const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
      const moved = direction === "forward" ? "a" : "c";
      ai.applySemanticEdits([direction === "forward"
        ? { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "c", position: "after" }
        : { kind: "structural", op: "moveBlock", nodeId: "c", anchorNodeId: "a", position: "before" }]);

      const units = ai.getRichBlocks().filter((unit) => unit.id === moved);
      expect(units.map((unit) => unit.text)).toEqual([direction === "forward" ? "alpha" : "gamma"]);
      const [unit] = units;
      if (!unit) throw new Error("no unit for the moved block");
      const result = ai.applySemanticEdits([{ kind: "richText", nodeId: moved, expectedContentHash: unitRichHash(unit), spans: [{ text: "NEW", marks: [] }] }]);
      expect(result.stale).toEqual([]);
      expect(result.applied).toBe(true);
    });
  }

  it("rejects a rich edit to a block proposed for deletion, rather than calling it both changed and missing", () => {
    const { ai } = build([para("a", "alpha"), para("b", "beta")]);
    ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "b" }]);
    const result = ai.applySemanticEdits([{ kind: "richText", nodeId: "b", spans: [{ text: "NEW", marks: [] }] }]);

    expect(result).toMatchObject({ applied: false, changed: [], notFound: [], rejected: ["b"] });
  });

  it("refuses a list item op named by a nested list, which is neither the item nor its text", () => {
    const { ai } = build([{ type: "bulletList", content: [
      { type: "listItem", attrs: { nodeId: "i1" }, content: [para("p1", "one"), { type: "bulletList", attrs: { nodeId: "N" }, content: [listItem("n1", "q1", "n-one")] }] },
      listItem("i2", "p2", "two"),
    ] }]);
    const result = ai.applySemanticEdits([{ kind: "structural", op: "moveListItem", nodeId: "N", anchorNodeId: "p2", position: "after" }]);

    expect(result).toMatchObject({ changed: [], rejected: ["N"] });
  });

  it("shows an agent a list moved down with its items", () => {
    const { ai } = build([
      { type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two")] },
      para("after", "after"),
    ]);
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "list", anchorNodeId: "after", position: "after" }]);

    const lists = ai.getRichBlocks().filter((unit) => unit.id === "list");
    expect(lists.map((unit) => (unit.parts ?? []).map((part) => part.nodeId))).toEqual([["p1", "p2"]]);
  });

  it("refuses both adding to a moved list and moving an item inside it", () => {
    const { ai } = build([
      { type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two")] },
      para("after", "after"),
    ]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "list", anchorNodeId: "after", position: "after" },
      { kind: "structural", op: "insertListItem", anchorNodeId: "p2", position: "after", item: { spans: [{ text: "three", marks: [] }] } },
      { kind: "structural", op: "moveListItem", nodeId: "p1", anchorNodeId: "p2", position: "after" },
    ]);

    expect(result.rejected).toEqual(["p2", "p1"]);
  });

  it("refuses an item added inside a list the batch moved", () => {
    const { editor, ai } = build([
      { type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two")] },
      para("after", "after"),
    ]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "list", anchorNodeId: "after", position: "after" },
      { kind: "structural", op: "insertListItem", anchorNodeId: "p2", position: "after", item: { spans: [{ text: "new", marks: [] }] } },
    ]);

    expect(result.rejected).toEqual(["p2"]);
    editor.commands.setChangeStatuses("rejected", changesOf(editor).map((c) => c.id));
    expect(textOf(editor).trimEnd()).toBe("one\ntwo\nafter");
  });

  it("refuses moving a list the batch added an item to", () => {
    const { editor, ai } = build([
      { type: "bulletList", attrs: { nodeId: "list" }, content: [listItem("i1", "p1", "one"), listItem("i2", "p2", "two")] },
      para("after", "after"),
    ]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "insertListItem", anchorNodeId: "p2", position: "after", item: { spans: [{ text: "new", marks: [] }] } },
      { kind: "structural", op: "moveBlock", nodeId: "list", anchorNodeId: "after", position: "after" },
    ]);

    expect(result).toMatchObject({ changed: ["p2"], rejected: ["list"] });
    expect(changesOf(editor).length).toBeGreaterThan(0);
  });

  it("refuses a second move of the same node in one batch", () => {
    // Two overlapping delete/insert pairs for one node are paired wrongly by
    // tracking and replay into a duplicate carrying a duplicate nodeId.
    const { editor, ai } = build([para("a", "alpha"), para("b", "beta"), para("c", "gamma")]);
    const result = ai.applySemanticEdits([
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "c", position: "after" },
      { kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "b", position: "before" },
    ]);

    expect(result.changed).toEqual(["a"]);
    expect(result.rejected).toEqual(["a"]);
    editor.commands.setChangeStatuses("accepted", changesOf(editor).map((c) => c.id));
    expect(textOf(editor)).toBe("beta\ngamma\nalpha");
    // One copy of the id, not two.
    const ids: string[] = [];
    editor.getState().doc.descendants((n) => { if (n.attrs["nodeId"] === "a") ids.push("a"); });
    expect(ids).toHaveLength(1);
  });

  it("a twelve-move reorder accepts and rejects in full", () => {
    const blocks = Array.from({ length: 14 }, (_, i) => para(`p${i}`, `t${i}`));
    const { editor, ai } = build(blocks);
    const original = textOf(editor);
    const moves: SemanticEdit[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "structural", op: "moveBlock", nodeId: `p${i}`, anchorNodeId: "p13", position: "after",
    }));
    const result = ai.applySemanticEdits(moves);

    expect(result.changed).toHaveLength(12);
    expect(result.rejected).toEqual([]);
    const accepted = build(blocks);
    accepted.ai.applySemanticEdits(moves);
    accepted.editor.commands.setChangeStatuses("accepted", changesOf(accepted.editor).map((c) => c.id));
    expect(textOf(accepted.editor).split("\n")).toEqual(["t12", "t13", "t11", "t10", "t9", "t8", "t7", "t6", "t5", "t4", "t3", "t2", "t1", "t0"]);
    editor.commands.setChangeStatuses("rejected", changesOf(editor).map((c) => c.id));
    expect(textOf(editor)).toBe(original);
  });
});

describe("an agent's structural edit is a proposal", () => {
  /** A person editing directly: their own edits are not tracked. */
  const editing = () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "person", initialStatus: TrackChangesStatus.disabled, canAcceptReject: true }), AiToolkit],
      content: { type: "doc", content: [para("a", "alpha"), para("b", "beta")] },
    });
    const ai = getAiToolkit(editor);
    if (!ai) throw new Error("no toolkit");
    return { editor, ai };
  };

  it("is tracked even while the person is editing, and credited to the agent", () => {
    const { editor, ai } = editing();
    ai.applySemanticEdits([{ kind: "structural", op: "moveBlock", nodeId: "a", anchorNodeId: "b", position: "after" }], { authorID: "agent" });

    const moves = changesOf(editor).filter((c) => c.dataTracked.operation === "move");
    expect(moves.map((c) => c.dataTracked.authorID)).toEqual(["agent"]);
    editor.commands.setChangeStatuses("rejected", changesOf(editor).map((c) => c.id));
    expect(textOf(editor)).toBe("alpha\nbeta");
  });

  it("is credited to the AI Assistant when no author is named, as a rewrite is", () => {
    const { editor, ai } = editing();
    ai.applySemanticEdits([{ kind: "structural", op: "deleteBlock", nodeId: "b" }]);

    expect(changesOf(editor).map((c) => c.dataTracked.authorID)).toContain("AI Assistant");
  });
});
