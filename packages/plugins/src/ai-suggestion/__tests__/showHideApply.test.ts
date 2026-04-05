/**
 * showHideApply integration tests.
 *
 * Tests apply and reject at the doc-mutation level using TestAiEditor.
 * Covers: direct mode, tracked mode, per-block scoping, state cleanup.
 */

import { describe, it, expect } from "vitest";
import { TestAiEditor, doc, p } from "./helpers";
import type { AiSuggestion } from "../types";
import { AI_SUGGESTION_SET_STALE } from "../AiSuggestionPlugin";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a simple rewrite suggestion (delete "quick" → insert "slow"). */
function rewriteSuggestion(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: "The quick fox",
        ops: [
          { type: "keep",   text: "The " },
          { type: "delete", text: "quick", groupId: "g1" },
          { type: "insert", text: "slow",  groupId: "g1" },
          { type: "keep",   text: " fox" },
        ],
      },
    ],
  };
}

function multiBlockSuggestion(n1: string, n2: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId: n1,
        acceptedText: "Hello world",
        ops: [
          { type: "keep",   text: "Hello " },
          { type: "delete", text: "world",    groupId: "g1" },
          { type: "insert", text: "universe", groupId: "g1" },
        ],
      },
      {
        nodeId: n2,
        acceptedText: "Foo bar",
        ops: [
          { type: "delete", text: "Foo", groupId: "g2" },
          { type: "insert", text: "Baz", groupId: "g2" },
          { type: "keep",   text: " bar" },
        ],
      },
    ],
  };
}

// ── showAiSuggestion ──────────────────────────────────────────────────────────

describe("showAiSuggestion", () => {
  it("sets suggestion in plugin state", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    const suggestion = rewriteSuggestion("n1");

    editor.showSuggestion(suggestion);

    expect(editor.suggestionState!.suggestion).toBe(suggestion);
  });

  it("clears suggestion when null is passed", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));
    editor.showSuggestion(null);

    expect(editor.suggestionState!.suggestion).toBeNull();
  });
});

// ── applyAiSuggestion — direct mode ──────────────────────────────────────────

describe("applyAiSuggestion — direct mode", () => {
  it("writes proposed text directly into the doc", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.apply({ blockId: "n1", mode: "direct" });

    expect(editor.text).toBe("The slow fox");
  });

  it("removes the accepted block from plugin state after apply", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.apply({ blockId: "n1", mode: "direct" });

    expect(editor.suggestionState!.suggestion).toBeNull();
  });

  it("removes only the accepted block when multiple blocks exist", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1"), p("Foo bar", "n2")));
    editor.showSuggestion(multiBlockSuggestion("n1", "n2"));

    editor.apply({ blockId: "n1", mode: "direct" });

    const remaining = editor.suggestionState!.suggestion?.blocks ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.nodeId).toBe("n2");
  });

  it("accepts all blocks when no blockId is provided", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1"), p("Foo bar", "n2")));
    editor.showSuggestion(multiBlockSuggestion("n1", "n2"));

    editor.apply({ mode: "direct" });

    expect(editor.suggestionState!.suggestion).toBeNull();
    expect(editor.text).toBe("Hello universeBaz bar");
  });
});

// ── applyAiSuggestion — tracked mode ─────────────────────────────────────────

describe("applyAiSuggestion — tracked mode", () => {
  it("records deletes as tracked_delete marks (text still present)", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.apply({ blockId: "n1", mode: "tracked" });

    // The delete op creates a tracked_delete mark — the text is still in the doc
    const state = editor.getState();
    let hasDeleteMark = false;
    state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "tracked_delete")) {
        hasDeleteMark = true;
      }
    });
    expect(hasDeleteMark).toBe(true);
  });

  it("records inserts as tracked_insert marks", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.apply({ blockId: "n1", mode: "tracked" });

    const state = editor.getState();
    let hasInsertMark = false;
    state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "tracked_insert")) {
        hasInsertMark = true;
      }
    });
    expect(hasInsertMark).toBe(true);
  });

  it("removes block from plugin state after tracked apply", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.apply({ blockId: "n1", mode: "tracked" });

    expect(editor.suggestionState!.suggestion).toBeNull();
  });
});

// ── rejectAiSuggestion ────────────────────────────────────────────────────────

describe("rejectAiSuggestion", () => {
  it("removes block from plugin state after reject", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.reject({ blockId: "n1" });

    expect(editor.suggestionState!.suggestion).toBeNull();
  });

  it("removes only the rejected block when multiple blocks exist", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1"), p("Foo bar", "n2")));
    editor.showSuggestion(multiBlockSuggestion("n1", "n2"));

    editor.reject({ blockId: "n1" });

    const remaining = editor.suggestionState!.suggestion?.blocks ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.nodeId).toBe("n2");
  });

  it("clears all blocks when no blockId is provided", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1"), p("Foo bar", "n2")));
    editor.showSuggestion(multiBlockSuggestion("n1", "n2"));

    editor.reject();

    expect(editor.suggestionState!.suggestion).toBeNull();
  });

  it("does not mutate doc text when rejecting a suggestion that has not been applied", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    editor.reject({ blockId: "n1" });

    // The suggestion was never applied to the doc, so text is unchanged
    expect(editor.text).toBe("The quick fox");
  });
});

// ── State consistency ─────────────────────────────────────────────────────────

describe("showHideApply — state consistency", () => {
  it("plugin state is null when no suggestion is active", () => {
    const editor = new TestAiEditor(doc(p("hello", "n1")));
    expect(editor.suggestionState!.suggestion).toBeNull();
  });

  it("setting a new suggestion resets staleBlockIds", () => {
    const editor = new TestAiEditor(doc(p("The quick fox", "n1")));
    const s = rewriteSuggestion("n1");
    editor.showSuggestion(s);

    // Manually mark a block stale via transaction
    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_STALE, new Set(["n1"])),
    );
    expect(editor.suggestionState!.staleBlockIds.size).toBe(1);

    // Setting a new suggestion should clear stale
    editor.showSuggestion({ blocks: [{ ...s.blocks[0]!, nodeId: "n1" }] });
    expect(editor.suggestionState!.staleBlockIds.size).toBe(0);
  });
});
