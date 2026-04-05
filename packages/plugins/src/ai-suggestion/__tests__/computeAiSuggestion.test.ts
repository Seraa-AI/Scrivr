/**
 * computeAiSuggestion tests.
 *
 * Pure function — takes an EditorState and returns a serializable AiSuggestion.
 * All tests use a plain EditorState with no plugins (only the schema matters).
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { schema, doc, p, h } from "./helpers";

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeState(d: import("prosemirror-model").Node) {
  return EditorState.create({ doc: d });
}

// ── No-change cases ───────────────────────────────────────────────────────────

describe("computeAiSuggestion — no-change cases", () => {
  it("returns null when proposed text equals accepted text", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("hello world", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "hello world" }],
      authorID: "ai",
    });

    expect(result).toBeNull();
  });

  it("returns null when the nodeId does not exist in the doc", () => {
    const state = makeState(doc(p("hello")));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId: "does-not-exist", proposedText: "anything" }],
      authorID: "ai",
    });

    expect(result).toBeNull();
  });

  it("returns null when all blocks are unchanged", () => {
    const state = makeState(doc(p("foo", "n1"), p("bar", "n2")));

    const result = computeAiSuggestion(state, {
      blocks: [
        { nodeId: "n1", proposedText: "foo" },
        { nodeId: "n2", proposedText: "bar" },
      ],
      authorID: "ai",
    });

    expect(result).toBeNull();
  });
});

// ── Op generation ─────────────────────────────────────────────────────────────

describe("computeAiSuggestion — op generation", () => {
  it("produces delete + insert ops for a word replacement", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("The quick fox", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "The slow fox" }],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    const ops = result!.blocks[0]!.ops;
    const types = ops.map((o) => o.type);

    expect(types).toContain("keep");
    expect(types).toContain("delete");
    expect(types).toContain("insert");
  });

  it("produces only insert ops when text is added", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("Hello", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "Hello world" }],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    const ops = result!.blocks[0]!.ops;
    expect(ops.some((o) => o.type === "insert")).toBe(true);
    expect(ops.every((o) => o.type !== "delete")).toBe(true);
  });

  it("produces only delete ops when text is removed", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("Hello world", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "Hello" }],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    const ops = result!.blocks[0]!.ops;
    expect(ops.some((o) => o.type === "delete")).toBe(true);
    expect(ops.every((o) => o.type !== "insert")).toBe(true);
  });

  it("paired delete+insert ops share a groupId", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("The quick brown fox", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "The slow red fox" }],
      authorID: "ai",
    });

    const ops = result!.blocks[0]!.ops.filter((o) => o.type !== "keep");
    const deleteOps = ops.filter((o) => o.type === "delete");
    const insertOps = ops.filter((o) => o.type === "insert");

    // At least one delete and one insert should share a groupId
    const deleteGroupIds = new Set(deleteOps.map((o) => o.groupId).filter(Boolean));
    const insertGroupIds = new Set(insertOps.map((o) => o.groupId).filter(Boolean));
    const sharedGroups = [...deleteGroupIds].filter((g) => insertGroupIds.has(g));

    expect(sharedGroups.length).toBeGreaterThan(0);
  });
});

// ── Multi-block ───────────────────────────────────────────────────────────────

describe("computeAiSuggestion — multi-block", () => {
  it("processes multiple blocks and returns one AiSuggestion with all blocks", () => {
    const state = makeState(doc(
      p("First paragraph", "n1"),
      p("Second paragraph", "n2"),
    ));

    const result = computeAiSuggestion(state, {
      blocks: [
        { nodeId: "n1", proposedText: "First rewrite" },
        { nodeId: "n2", proposedText: "Second rewrite" },
      ],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    expect(result!.blocks).toHaveLength(2);
    expect(result!.blocks.map((b) => b.nodeId)).toEqual(["n1", "n2"]);
  });

  it("skips unchanged blocks but includes changed ones", () => {
    const state = makeState(doc(
      p("Unchanged text", "n1"),
      p("This will change", "n2"),
    ));

    const result = computeAiSuggestion(state, {
      blocks: [
        { nodeId: "n1", proposedText: "Unchanged text" }, // same
        { nodeId: "n2", proposedText: "This has changed" },
      ],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    expect(result!.blocks).toHaveLength(1);
    expect(result!.blocks[0]!.nodeId).toBe("n2");
  });
});

// ── summary field ─────────────────────────────────────────────────────────────

describe("computeAiSuggestion — summary", () => {
  it("passes summary through to the block when provided", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("Hello world", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [
        {
          nodeId,
          proposedText: "Hello universe",
          summary: "Simplified tone and broadened scope",
        },
      ],
      authorID: "ai",
    });

    expect(result!.blocks[0]!.summary).toBe("Simplified tone and broadened scope");
  });

  it("omits summary when not provided", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("Hello world", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "Hello universe" }],
      authorID: "ai",
    });

    expect(result!.blocks[0]!.summary).toBeUndefined();
  });
});

// ── acceptedText ──────────────────────────────────────────────────────────────

describe("computeAiSuggestion — acceptedText", () => {
  it("records the block's current text as acceptedText", () => {
    const nodeId = "p1";
    const state = makeState(doc(p("The original text", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "The new text" }],
      authorID: "ai",
    });

    expect(result!.blocks[0]!.acceptedText).toBe("The original text");
  });

  it("works with heading nodes", () => {
    const nodeId = "h1";
    const state = makeState(doc(h(1, "Introduction", nodeId)));

    const result = computeAiSuggestion(state, {
      blocks: [{ nodeId, proposedText: "Overview" }],
      authorID: "ai",
    });

    expect(result).not.toBeNull();
    expect(result!.blocks[0]!.acceptedText).toBe("Introduction");
  });
});
