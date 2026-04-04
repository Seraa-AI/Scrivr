import { describe, it, expect } from "vitest";
import { ChangeSet } from "../ChangeSet";
import { CHANGE_OPERATION, CHANGE_STATUS, NodeChange, TextChange } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTextChange(id: string, authorID = "user:Alice", from = 1, to = 5): TextChange {
  return {
    id,
    type: "text-change",
    from,
    to,
    text: "hello",
    nodeType: {} as any,
    dataTracked: {
      id,
      authorID,
      reviewedByID: null,
      operation: CHANGE_OPERATION.insert,
      status: CHANGE_STATUS.pending,
      statusUpdateAt: 0,
      createdAt: 1000,
      updatedAt: 1000,
    },
  };
}

function makeNodeChange(id: string, from: number, to: number, authorID: string): NodeChange {
  return {
    id,
    type: "node-change",
    from,
    to,
    node: {} as any,
    attrs: {},
    children: [],
    dataTracked: {
      id,
      authorID,
      reviewedByID: null,
      operation: CHANGE_OPERATION.insert,
      status: CHANGE_STATUS.pending,
      statusUpdateAt: 0,
      createdAt: 1000,
      updatedAt: 1000,
    },
  };
}

// ── getNotIn ──────────────────────────────────────────────────────────────────

describe("ChangeSet.getNotIn", () => {
  it("returns changes whose IDs are NOT in the provided list", () => {
    const a = makeTextChange("aaa");
    const b = makeTextChange("bbb");
    const c = makeTextChange("ccc");
    const cs = new ChangeSet([a, b, c]);

    const result = cs.getNotIn(["aaa", "ccc"]);
    expect(result.map(r => r.dataTracked.id)).toEqual(["bbb"]);
  });

  it("returns all changes when the exclusion list is empty", () => {
    const a = makeTextChange("aaa");
    const b = makeTextChange("bbb");
    const cs = new ChangeSet([a, b]);

    expect(cs.getNotIn([])).toHaveLength(2);
  });

  it("returns empty array when all IDs are excluded", () => {
    const a = makeTextChange("aaa");
    const cs = new ChangeSet([a]);

    expect(cs.getNotIn(["aaa"])).toHaveLength(0);
  });

  it("is the complement of getIn", () => {
    const a = makeTextChange("aaa");
    const b = makeTextChange("bbb");
    const c = makeTextChange("ccc");
    const cs = new ChangeSet([a, b, c]);
    const ids = ["aaa", "ccc"];

    const inSet = cs.getIn(ids).map(r => r.dataTracked.id);
    const notInSet = cs.getNotIn(ids).map(r => r.dataTracked.id);

    expect([...inSet, ...notInSet].sort()).toEqual(["aaa", "bbb", "ccc"]);
  });
});

// ── changeTree ────────────────────────────────────────────────────────────────

describe("ChangeSet.changeTree", () => {
  it("keeps changes from different authors as separate root nodes even when positions overlap", () => {
    // Author Alice owns a node-change spanning 1–10.
    // Author Bob has a text-change inside that range (3–7).
    // Because they belong to different authors, Bob's change must NOT be nested
    // inside Alice's node-change — both appear as independent root entries.
    const aliceNode = makeNodeChange("alice-node", 1, 10, "user:Alice");
    const bobText = makeTextChange("bob-text", "user:Bob", 3, 7);

    const cs = new ChangeSet([aliceNode, bobText]);
    const tree = cs.changeTree;

    expect(tree).toHaveLength(2);
    expect(tree.map(c => c.id)).toEqual(["alice-node", "bob-text"]);
  });

  it("nests a same-author change inside an enclosing node-change", () => {
    // Both changes belong to Alice, and Bob's text sits inside Alice's node range.
    // It should be added as a child of the node-change.
    const aliceNode = makeNodeChange("alice-node", 1, 10, "user:Alice");
    const aliceText = makeTextChange("alice-text", "user:Alice", 3, 7);

    const cs = new ChangeSet([aliceNode, aliceText]);
    const tree = cs.changeTree;

    // Only the node-change appears at the root; the text-change is a child.
    expect(tree).toHaveLength(1);
    const root = tree[0] as NodeChange;
    expect(root.id).toBe("alice-node");
    expect(root.children.map(c => c.id)).toEqual(["alice-text"]);
  });

  it("flushes a node-change when the next change comes from a different author", () => {
    // Alice node-change (1–10), then Carol text-change (11–15) — positions don't
    // overlap so the node-change would be flushed on position grounds anyway, but
    // we also confirm author-mismatch flush by giving Carol a range that touches
    // the end boundary exactly.
    const aliceNode = makeNodeChange("alice-node", 1, 10, "user:Alice");
    const carolText = makeTextChange("carol-text", "user:Carol", 10, 15);

    const cs = new ChangeSet([aliceNode, carolText]);
    const tree = cs.changeTree;

    expect(tree).toHaveLength(2);
    expect(tree[0]!.id).toBe("alice-node");
    expect(tree[1]!.id).toBe("carol-text");
  });
});
