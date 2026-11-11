/**
 * computeAiSuggestion tests.
 *
 * Pure function — takes an EditorState and returns a serializable AiSuggestion.
 * All tests use a plain EditorState with no plugins (only the schema matters).
 */

import { describe, it, expect } from "vitest";
import type { Node as PmNode } from "@scrivr/core/pm";
import { EditorState } from "@scrivr/core/pm";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, moveFirstBlockToEnd, p, h, schema } from "./helpers";


function makeState(d: PmNode) {
  return EditorState.create({ doc: d });
}

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

describe("computeAiSuggestion — phrases, as the tracked rewrite shows them", () => {
  /** Each group's removed and added text, in document order. */
  const groups = (state: EditorState, proposedText: string) => {
    const ops = computeAiSuggestion(state, { blocks: [{ nodeId: "p1", proposedText }], authorID: "ai" })
      ?.blocks[0]?.ops ?? [];
    const byGroup = new Map<string, string[]>();
    for (const op of ops) {
      if (op.type === "keep" || !op.groupId) continue;
      byGroup.set(op.groupId, [...(byGroup.get(op.groupId) ?? []), `${op.type === "delete" ? "-" : "+"}${op.text}`]);
    }
    return [...byGroup.values()];
  };

  it("replaces changes close together as one phrase", () => {
    const state = makeState(doc(p("All staff, contractors is covered.", "p1")));
    expect(groups(state, "All staff; contractors are covered.")).toEqual([["-, contractors is", "+; contractors are"]]);
  });

  it("keeps changes far apart as separate replacements", () => {
    const state = makeState(doc(p("Core hours is ten to three in the employees local timezone.", "p1")));
    expect(groups(state, "Core hours are ten to three in the employee's local timezone.")).toEqual([
      ["-is", "+are"],
      ["-employees", "+employee's"],
    ]);
  });

  it("keeps formatted words out of a replacement, as the tracked rewrite does", () => {
    const bold = schema.marks["bold"];
    if (!bold) throw new Error("no bold mark");
    const paragraph = schema.node("paragraph", { nodeId: "p1" }, [
      schema.text("teh "), schema.text("big", [bold.create()]), schema.text(" smal"),
    ]);
    expect(groups(makeState(doc(paragraph)), "the big small")).toEqual([["-teh", "+the"], ["-smal", "+small"]]);
  });

  it("replaces a misspelt word whole, not the letters inside it", () => {
    const state = makeState(doc(p("The policy applys to all staff.", "p1")));
    expect(groups(state, "The policy applies to all staff.")).toEqual([["-applys", "+applies"]]);
  });
});

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

describe("computeAiSuggestion — a block with a pending move", () => {
  it("diffs against the moved block, not the copy it left behind", () => {
    const editor = new AiTestEditor(doc(p("The quick fox", "b1"), p("tail", "b2")));
    moveFirstBlockToEnd(editor);

    const result = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "b1", proposedText: "The slow fox" }],
      authorID: "AI Assistant",
    });
    expect(result?.blocks.map((block) => block.acceptedText)).toEqual(["The quick fox"]);
  });
});
